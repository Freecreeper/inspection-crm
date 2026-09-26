import Link from "next/link";
import { formatShortDate } from "@/lib/dates";
import {
  TIMELINE_FILTERS,
  TIMELINE_FILTER_LABELS,
  filterTimeline,
  loadRealtorTimeline,
  type TimelineFilter,
  type TimelineItem,
} from "@/lib/realtors/timeline";
import type { RecordPermissions } from "./ui";

const LIMIT = 150;

function groupByDay(items: TimelineItem[]) {
  const groups: { key: string; label: string; items: TimelineItem[] }[] = [];
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

export async function ActivityTab({ realtorId, filter, permissions }: { realtorId: string; filter: TimelineFilter; permissions: RecordPermissions }) {
  const all = await loadRealtorTimeline(realtorId, { limit: LIMIT, includeDocuments: permissions.canReadDocuments });
  const items = filterTimeline(all, filter);
  const groups = groupByDay(items);

  return (
    <div>
      <nav aria-label="Filter activity" className="flex flex-wrap gap-2">
        {TIMELINE_FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? `/realtors/${realtorId}?tab=activity` : `/realtors/${realtorId}?tab=activity&type=${f}`}
            aria-current={filter === f ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === f ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {TIMELINE_FILTER_LABELS[f]}
          </Link>
        ))}
      </nav>

      {groups.length === 0 ? (
        <p className="mt-6 rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {filter === "all" ? "No activity recorded yet." : `No ${TIMELINE_FILTER_LABELS[filter].toLowerCase()} recorded.`}
        </p>
      ) : (
        <ol className="mt-6 space-y-6">
          {groups.map((group) => (
            <li key={group.key}>
              <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">{group.label}</h2>
              <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {group.items.map((item) => (
                  <li key={item.id} className="px-4 py-3 text-sm">
                    <p className="text-slate-900">
                      {item.href ? (
                        <Link href={item.href} className="hover:underline">
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
                    </p>
                    {item.detail && <p className="mt-0.5 text-slate-600">{item.detail}</p>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {all.length >= LIMIT && <p className="mt-3 text-xs text-slate-500">Showing the {LIMIT} most recent events.</p>}
    </div>
  );
}
