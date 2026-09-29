"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Circle, CircleCheck, CircleDot, OctagonAlert, Phone } from "lucide-react";
import type { CalendarEvent } from "@/lib/calendar/types";
import { formatDay, formatTime, type DayKey } from "@/lib/calendar/time";
import { formatUsd } from "@/lib/dashboard/layout";
import { KPI_BY_KEY, TIMEFRAME_LABELS, type KpiKey } from "@/lib/dashboard/registry";
import type { ActivityEntry, AttentionItem, AttentionSeverity, InvoiceRow, KpiValue, LeadRow, ReportRow, TaskRow, UpcomingDay, WidgetData } from "@/lib/dashboard/types";
import { telHref } from "@/lib/realtors/display";
import { EVENT_KIND, EventIcon } from "../../calendar/_components/eventStyle";
import { completeTask } from "../../tasks/actions";

// Presentational Dashboard widgets. Each shows the few facts needed for the
// next decision and makes the rest one interaction away: a row opens the
// shared preview drawer (the same one the Calendar uses) or links to the
// full record.

export type OpenPreview = (target: { type: "inspection" | "task" | "event"; id: string; title: string; event?: CalendarEvent }) => void;

const linkClass = "inline-flex min-h-9 items-center gap-1 text-sm font-medium text-emerald-700 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-600";
const actionClass =
  "inline-flex min-h-9 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600";
const rowButton = "w-full rounded-md text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600";

export function WidgetCard({
  id,
  title,
  meta,
  prominent = false,
  footer,
  children,
}: {
  id: string;
  title: string;
  meta?: React.ReactNode;
  prominent?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`widget-${id}`} className="flex h-full flex-col rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pb-2 pt-3.5">
        <h2 id={`widget-${id}`} className={`text-xs font-semibold uppercase tracking-wide ${prominent ? "text-slate-900" : "text-slate-500"}`}>
          {title}
        </h2>
        {meta}
      </header>
      <div className="flex-1 px-4 pb-3">{children}</div>
      {footer && <div className="border-t border-slate-100 px-4 py-1">{footer}</div>}
    </section>
  );
}

export function WidgetSkeleton({ title }: { title: string }) {
  return (
    <WidgetCard id={`loading-${title}`} title={title}>
      <div className="space-y-2" aria-busy="true" aria-label={`Loading ${title}`}>
        <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
      </div>
    </WidgetCard>
  );
}

export function WidgetError({ title, message }: { title: string; message: string }) {
  return (
    <WidgetCard id={`error-${title}`} title={title}>
      <p className="flex items-center gap-2 text-sm text-slate-600">
        <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
        {message}
      </p>
    </WidgetCard>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-sm text-slate-500">{children}</p>;
}

function dayLabel(day: DayKey, today: DayKey): string {
  if (day === today) return "Today";
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (day === tomorrow.toISOString().slice(0, 10)) return "Tomorrow";
  return formatDay(day, "short");
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

function Readiness({ e }: { e: CalendarEvent }) {
  if (e.status === "COMPLETED") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
        <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" /> Completed
      </span>
    );
  }
  if (e.warnings.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <Check className="h-3.5 w-3.5" aria-hidden="true" /> Ready
      </span>
    );
  }
  return (
    <span className="text-xs font-medium text-amber-800">
      <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
      {e.warnings[0].label}
      {e.warnings.length > 1 && <span className="font-normal text-amber-700"> +{e.warnings.length - 1} more</span>}
    </span>
  );
}

export function TodayWidget({ data, timeZone, showInspector, onOpen }: { data: Extract<WidgetData, { key: "today" }>; timeZone: string; showInspector: boolean; onOpen: OpenPreview }) {
  const inspections = data.events.filter((e) => e.type === "inspection").length;
  return (
    <WidgetCard
      id="today"
      title="Today"
      prominent
      meta={
        <span className="text-xs text-slate-500">
          {inspections} inspection{inspections === 1 ? "" : "s"}
          {data.events.length > inspections && ` · ${data.events.length - inspections} other`}
        </span>
      }
      footer={
        <Link href="/calendar?view=day" className={linkClass}>
          View Calendar <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      {data.events.length === 0 ? (
        <Empty>Nothing scheduled today.</Empty>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {data.events.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onOpen({ type: "event", id: e.sourceId, title: e.title, event: e })}
                className={`flex h-full min-h-11 flex-col gap-0.5 border px-3 py-2.5 ${rowButton} ${e.type === "inspection" ? "border-slate-200 border-l-4 border-l-emerald-600" : "border-slate-200"}`}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold tabular-nums text-slate-500">
                  <EventIcon event={e} />
                  {e.allDay || !e.start ? EVENT_KIND[e.type].label : `${formatTime(new Date(e.start), timeZone)}`}
                </span>
                <span className="line-clamp-2 text-sm font-medium text-slate-900">{e.title}</span>
                {e.subtitle && <span className="truncate text-sm text-slate-600">{e.subtitle}</span>}
                {showInspector && e.type === "inspection" && <span className="text-xs text-slate-500">{e.inspectorName ?? "No inspector"}</span>}
                {e.type === "inspection" && <Readiness e={e} />}
                {e.type === "realtorFollowUp" && <span className="text-xs font-medium text-emerald-700">Contact</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Needs Attention
// ---------------------------------------------------------------------------

const SEVERITY: Record<AttentionSeverity, { label: string; icon: typeof Circle; className: string }> = {
  critical: { label: "Critical", icon: OctagonAlert, className: "text-rose-600" },
  warning: { label: "Warning", icon: AlertTriangle, className: "text-amber-600" },
  action: { label: "Action", icon: CircleDot, className: "text-slate-700" },
  info: { label: "For information", icon: Circle, className: "text-slate-400" },
};

export const ATTENTION_PREVIEW_LIMIT = 6;

export function AttentionWidget({ data, onOpen }: { data: Extract<WidgetData, { key: "needsAttention" }>; onOpen: OpenPreview }) {
  const [expanded, setExpanded] = useState(false);
  const items = expanded ? data.items : data.items.slice(0, ATTENTION_PREVIEW_LIMIT);
  const critical = data.items.filter((i) => i.severity === "critical").length;
  return (
    <WidgetCard
      id="needsAttention"
      title="Needs Attention"
      prominent
      meta={
        data.items.length > 0 && (
          <span className="text-xs text-slate-500">
            {data.items.length} item{data.items.length === 1 ? "" : "s"}
            {critical > 0 && <span className="font-medium text-rose-700"> · {critical} critical</span>}
          </span>
        )
      }
      footer={
        data.items.length > ATTENTION_PREVIEW_LIMIT && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className={linkClass} aria-expanded={expanded}>
            {expanded ? "Show fewer" : `View all ${data.items.length}`}
            <ArrowRight className={`h-3.5 w-3.5 transition-transform ${expanded ? "-rotate-90" : ""}`} aria-hidden="true" />
          </button>
        )
      }
    >
      {data.items.length === 0 ? (
        <p className="flex items-center gap-2 py-3 text-sm text-slate-600">
          <CircleCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" /> All clear — nothing needs attention.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <AttentionRow key={item.id} item={item} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function AttentionRow({ item, onOpen }: { item: AttentionItem; onOpen: OpenPreview }) {
  const s = SEVERITY[item.severity];
  const Icon = s.icon;
  const preview = item.preview;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Icon className={`h-4 w-4 shrink-0 ${s.className}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="sr-only">{s.label}: </span>
          <span className="font-medium text-slate-900">{item.title}</span>
          <span className="text-slate-600"> · {item.subject}</span>
        </p>
        {item.detail && <p className="text-xs text-slate-500 sm:truncate">{item.detail}</p>}
      </div>
      {preview ? (
        <button type="button" onClick={() => onOpen({ type: preview.type, id: preview.id, title: item.subject })} className={actionClass}>
          {item.actionLabel}
          <span className="sr-only">: {item.title}, {item.subject}</span>
        </button>
      ) : (
        <Link href={item.href} className={actionClass}>
          {item.actionLabel}
          <span className="sr-only">: {item.title}, {item.subject}</span>
        </Link>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Business Snapshot
// ---------------------------------------------------------------------------

function kpiDisplay(key: KpiKey, value: number | null | undefined): string {
  if (value === undefined) return "…";
  if (value === null) return "—";
  return KPI_BY_KEY[key].format === "money" ? formatUsd(value) : value.toLocaleString("en-US");
}

export function SnapshotWidget({ kpis, values, canViewReports }: { kpis: KpiKey[]; values: KpiValue[] | null; canViewReports: boolean }) {
  const byKey = new Map(values?.map((v) => [v.key, v.value]));
  const cols = kpis.length >= 5 ? "lg:grid-cols-6" : kpis.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4";
  return (
    <WidgetCard
      id="snapshot"
      title="Business Snapshot"
      footer={
        canViewReports && (
          <Link href="/reports" className={linkClass}>
            View Business Analytics <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )
      }
    >
      {kpis.length === 0 ? (
        <Empty>No KPIs chosen. Use Customize to pick up to six.</Empty>
      ) : (
        <ul className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${cols}`}>
          {kpis.map((key) => {
            const def = KPI_BY_KEY[key];
            const value = values ? (byKey.has(key) ? byKey.get(key) : undefined) : undefined;
            return (
              <li key={key}>
                <Link href={def.href} title={def.definition} className="block h-full rounded-md border border-slate-200 px-3 py-2.5 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600">
                  <span className="block text-xl font-semibold tabular-nums text-slate-900">{kpiDisplay(key, value)}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{def.label}</span>
                  {value === null && <span className="sr-only">No data yet</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Upcoming
// ---------------------------------------------------------------------------

export function UpcomingWidget({ data, today }: { data: Extract<WidgetData, { key: "upcoming" }>; today: DayKey }) {
  return (
    <WidgetCard
      id="upcoming"
      title="Upcoming"
      meta={<span className="text-xs text-slate-500">{TIMEFRAME_LABELS[data.timeframe]} · {data.total} inspection{data.total === 1 ? "" : "s"}</span>}
      footer={
        <Link href="/calendar?view=week" className={linkClass}>
          Open Calendar <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      {data.days.length === 0 ? (
        <Empty>No inspections scheduled in this period.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.days.map((d: UpcomingDay) => (
            <li key={d.day}>
              <Link href={`/calendar?view=day&date=${d.day}`} className={`flex items-center justify-between gap-3 px-1 py-2 ${rowButton}`}>
                <span className="text-sm font-medium text-slate-900">{dayLabel(d.day, today)}</span>
                <span className="flex items-center gap-2 text-sm text-slate-600">
                  {d.needsAttention > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      {d.needsAttention} need{d.needsAttention === 1 ? "s" : ""} attention
                    </span>
                  )}
                  <span className="tabular-nums">
                    {d.inspections} inspection{d.inspections === 1 ? "" : "s"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Recent Activity
// ---------------------------------------------------------------------------

function whenLabel(at: string, today: DayKey, timeZone: string): string {
  const d = new Date(at);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = formatTime(d, timeZone);
  return day === today ? time : `${dayLabel(day, today)} ${time}`;
}

export function ActivityWidget({ data, today, timeZone }: { data: Extract<WidgetData, { key: "recentActivity" }>; today: DayKey; timeZone: string }) {
  const [expanded, setExpanded] = useState(false);
  const entries = expanded ? data.entries : data.entries.slice(0, 8);
  return (
    <WidgetCard
      id="recentActivity"
      title="Recent Activity"
      meta={<span className="text-xs text-slate-500">Last 7 days</span>}
      footer={
        data.entries.length > 8 && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className={linkClass} aria-expanded={expanded}>
            {expanded ? "Show less" : "View more activity"} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )
      }
    >
      {data.entries.length === 0 ? (
        <Empty>Nothing recorded in the last 7 days.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {entries.map((e: ActivityEntry) => {
            const body = (
              <>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{e.label}</span>
                  {(e.detail || e.actor) && <span className="block truncate text-xs text-slate-500">{[e.detail, e.actor && `by ${e.actor}`].filter(Boolean).join(" · ")}</span>}
                </span>
                <time dateTime={e.at} className="shrink-0 text-xs tabular-nums text-slate-500">
                  {whenLabel(e.at, today, timeZone)}
                </time>
              </>
            );
            return (
              <li key={e.id}>
                {e.href ? (
                  <Link href={e.href} className={`flex items-start justify-between gap-3 px-1 py-2 ${rowButton}`}>
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-start justify-between gap-3 px-1 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Tasks and Realtor follow-ups (both are Task records)
// ---------------------------------------------------------------------------

function DueLabel({ row, today }: { row: TaskRow; today: DayKey }) {
  if (!row.due) return <span className="text-xs text-slate-500">No due date</span>;
  if (row.overdue) return <span className="text-xs font-medium text-amber-800">Overdue · {formatDay(row.due, "short")}</span>;
  return <span className="text-xs text-slate-500">{dayLabel(row.due, today)}</span>;
}

function CompleteButton({ row, onDone }: { row: TaskRow; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          setError(false);
          try {
            await completeTask(row.id);
            onDone();
          } catch {
            setError(true);
          }
        })
      }
      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-emerald-700 hover:border-emerald-600 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-50"
      aria-label={`Mark "${row.title}" complete`}
      title={error ? "Couldn't complete — you may not have permission." : "Mark complete"}
    >
      {pending ? <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-600" /> : error ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> : null}
    </button>
  );
}

export function TasksWidget({
  data,
  title,
  today,
  canComplete,
  onOpen,
  onChanged,
}: {
  data: Extract<WidgetData, { key: "myTasks" }>;
  title: string;
  today: DayKey;
  canComplete: boolean;
  onOpen: OpenPreview;
  onChanged: () => void;
}) {
  return (
    <WidgetCard
      id="myTasks"
      title={title}
      meta={<span className="text-xs text-slate-500">{data.total} due this week or overdue</span>}
      footer={
        <Link href="/tasks" className={linkClass}>
          All tasks <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      {data.rows.length === 0 ? (
        <Empty>No open tasks due this week.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.rows.map((row) => (
            <li key={row.id} className="flex items-start gap-3 py-2">
              {canComplete && <CompleteButton row={row} onDone={onChanged} />}
              <button type="button" onClick={() => onOpen({ type: "task", id: row.id, title: row.title })} className={`min-w-0 flex-1 px-1 ${rowButton}`}>
                <span className="block text-sm font-medium text-slate-900">{row.title}</span>
                <span className="flex flex-wrap gap-x-2 text-xs text-slate-500">
                  <DueLabel row={row} today={today} />
                  {row.context && <span className="truncate">{row.context}</span>}
                  {row.assigneeName && <span>{row.assigneeName}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export function FollowUpsWidget({ data, today, onOpen }: { data: Extract<WidgetData, { key: "realtorFollowUps" }>; today: DayKey; onOpen: OpenPreview }) {
  return (
    <WidgetCard
      id="realtorFollowUps"
      title="Realtor Follow-Ups"
      meta={<span className="text-xs text-slate-500">{data.total} due this week or overdue</span>}
      footer={
        <Link href="/realtors?needsFollowUp=1" className={linkClass}>
          All follow-ups <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      {data.rows.length === 0 ? (
        <Empty>No follow-ups due this week.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.rows.map((row) => (
            <li key={row.id} className="flex items-center gap-2 py-2">
              <button type="button" onClick={() => onOpen({ type: "task", id: row.id, title: row.title })} className={`min-w-0 flex-1 px-1 ${rowButton}`}>
                <span className="block text-sm font-medium text-slate-900">{row.realtor?.name ?? row.title}</span>
                <span className="flex flex-wrap gap-x-2 text-xs text-slate-500">
                  <DueLabel row={row} today={today} />
                  <span className="truncate">{row.title}</span>
                </span>
              </button>
              {row.realtor?.phone && (
                <a href={telHref(row.realtor.phone)} className={actionClass} aria-label={`Call ${row.realtor.name}`}>
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              )}
              <button type="button" onClick={() => onOpen({ type: "task", id: row.id, title: row.title })} className={actionClass}>
                Contact<span className="sr-only"> {row.realtor?.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Reports needing completion
// ---------------------------------------------------------------------------

export function ReportsWidget({ data }: { data: Extract<WidgetData, { key: "reportsPending" }> }) {
  return (
    <WidgetCard
      id="reportsPending"
      title="Reports Needing Completion"
      meta={<span className="text-xs text-slate-500">{data.total} open</span>}
      footer={
        <Link href="/inspections?filter=report-pending" className={linkClass}>
          All unfinished reports <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      {data.rows.length === 0 ? (
        <Empty>Every completed inspection has a finalized report.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.rows.map((r: ReportRow) => (
            <li key={r.inspectionId}>
              <Link href={r.href} className={`flex items-start justify-between gap-3 px-1 py-2 ${rowButton}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{r.address}</span>
                  <span className="block text-xs text-slate-500">
                    {[r.inspectedOn && `Inspected ${formatDay(r.inspectedOn, "short")}`, r.inspectorName].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={`shrink-0 text-xs font-medium ${r.overdue ? "text-amber-800" : "text-slate-600"}`}>
                  {r.overdue && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />}
                  {r.statusLabel}
                  {r.overdue && <span className="sr-only"> (overdue)</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Outstanding invoices
// ---------------------------------------------------------------------------

export function InvoicesWidget({ data, today }: { data: Extract<WidgetData, { key: "outstandingInvoices" }>; today: DayKey }) {
  return (
    <WidgetCard
      id="outstandingInvoices"
      title="Outstanding Invoices"
      meta={
        <span className="text-xs text-slate-500">
          {data.total} · <span className="font-medium text-slate-700">{formatUsd(data.balance, true)}</span> due
        </span>
      }
      footer={
        <Link href="/invoices" className={linkClass}>
          All invoices <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      {data.rows.length === 0 ? (
        <Empty>No balances due.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.rows.map((inv: InvoiceRow) => (
            <li key={inv.id}>
              <Link href={inv.href} className={`flex items-start justify-between gap-3 px-1 py-2 ${rowButton}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{inv.customer ?? `Invoice ${inv.invoiceNumber}`}</span>
                  <span className={`block text-xs ${inv.overdue ? "font-medium text-amber-800" : "text-slate-500"}`}>
                    {inv.invoiceNumber}
                    {inv.due ? ` · ${inv.overdue ? "overdue since" : "due"} ${dayLabel(inv.due, today)}` : " · no due date"}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-slate-900">{formatUsd(inv.balance, true)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Lead activity
// ---------------------------------------------------------------------------

export function LeadsWidget({ data, today }: { data: Extract<WidgetData, { key: "leadActivity" }>; today: DayKey }) {
  return (
    <WidgetCard
      id="leadActivity"
      title="Lead Activity"
      meta={<span className="text-xs text-slate-500">{TIMEFRAME_LABELS[data.timeframe]}</span>}
      footer={
        <Link href="/leads" className={linkClass}>
          All leads <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <dt className="text-xs text-slate-500">New leads</dt>
          <dd className="text-lg font-semibold tabular-nums text-slate-900">{data.created}</dd>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <dt className="text-xs text-slate-500">Converted</dt>
          <dd className="text-lg font-semibold tabular-nums text-slate-900">{data.converted}</dd>
        </div>
      </dl>
      {data.recent.length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-medium text-slate-500">Most recent</h3>
          <ul className="divide-y divide-slate-100">
            {data.recent.map((l: LeadRow) => (
              <li key={l.id}>
                <Link href={`/leads/${l.id}`} className={`flex items-center justify-between gap-3 px-1 py-1.5 ${rowButton}`}>
                  <span className="min-w-0 truncate text-sm text-slate-900">
                    {l.name}
                    {l.source && <span className="text-slate-500"> · {l.source}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {l.status.toLowerCase()} · {dayLabel(l.createdDay, today)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </WidgetCard>
  );
}
