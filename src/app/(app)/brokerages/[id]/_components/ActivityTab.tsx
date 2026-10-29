import Link from "next/link";
import { formatShortDate } from "@/lib/dates";
import {
  BROKERAGE_TIMELINE_FILTERS,
  BROKERAGE_TIMELINE_FILTER_LABELS,
  filterBrokerageTimeline,
  loadBrokerageTimeline,
  type BrokerageTimelineFilter,
  type BrokerageTimelineItem,
} from "@/lib/brokerages/record";

const LIMIT = 150;

function groupByDay(items: BrokerageTimelineItem[]) {
  const groups: { key: string; label: string; items: BrokerageTimelineItem[] }[] = [];
  for (const item of items) {
    const key = item.at.toDateString();
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: formatShortDate(item.at), items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export async function ActivityTab({ brokerageId, filter }: { brokerageId: string; filter: BrokerageTimelineFilter }) {
  const all = await loadBrokerageTimeline(brokerageId, { limit: LIMIT });
  const groups = groupByDay(filterBrokerageTimeline(all, filter));

  return (
    <div>
      <nav aria-label="Filter activity" className="flex flex-wrap gap-2">
        {BROKERAGE_TIMELINE_FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? `/brokerages/${brokerageId}?tab=activity` : `/brokerages/${brokerageId}?tab=activity&type=${f}`}
            aria-current={filter === f ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === f ? "border-neutral-900 bg-primary text-primary-foreground" : "border-border bg-surface text-neutral-700 hover:bg-hover"
            }`}
          >
            {BROKERAGE_TIMELINE_FILTER_LABELS[f]}
          </Link>
        ))}
      </nav>

      {groups.length === 0 ? (
        <p className="mt-6 rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          {filter === "all" ? "No activity recorded yet." : `No ${BROKERAGE_TIMELINE_FILTER_LABELS[filter].toLowerCase()} recorded.`}
        </p>
      ) : (
        <ol className="mt-6 space-y-6">
          {groups.map((group) => (
            <li key={group.key}>
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</h2>
              <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-border bg-surface">
                {group.items.map((item) => (
                  <li key={item.id} className="px-4 py-3 text-sm">
                    <p className="text-foreground">
                      {item.href ? (
                        <Link href={item.href} className="hover:underline">
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
                    </p>
                    {item.detail && <p className="mt-0.5 text-neutral-600">{item.detail}</p>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {all.length >= LIMIT && <p className="mt-3 text-xs text-muted-foreground">Showing the {LIMIT} most recent events.</p>}
    </div>
  );
}
