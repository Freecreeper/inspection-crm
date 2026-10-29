// Pure (client-safe). The one shape every board widget returns: urgent
// items, each with a severity worked out from its due date in the business
// time zone. Severity alone decides the red / amber / blue badges, so a
// tile's chosen color can never hide that something is late.

import { addDays, formatDay, formatTime, startOfDayUtc, toDayKey, type DayKey } from "@/lib/calendar/time";
import type { AttentionItem } from "@/lib/dashboard/types";
import type { TileWindow, WidgetKey } from "./catalog";

export const SEVERITIES = ["overdue", "today", "soon", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABELS: Record<Severity, string> = { overdue: "Overdue", today: "Today", soon: "Soon", info: "Open" };
const RANK: Record<Severity, number> = { overdue: 0, today: 1, soon: 2, info: 3 };

export type ItemAction =
  | { kind: "open"; label: string; href: string }
  | { kind: "call"; label: string; phone: string }
  | { kind: "email"; label: string; email: string }
  | { kind: "completeTask"; label: string; taskId: string }
  | { kind: "snoozeTask"; label: string; taskId: string; until: DayKey };

export interface BoardItem {
  id: string;
  title: string;
  subtitle: string | null;
  // ISO instant, or YYYY-MM-DD for date-only due dates; null = undated.
  due: string | null;
  dueLabel: string | null;
  severity: Severity;
  href: string;
  // The first is the item's main action (shown on large tiles).
  actions: ItemAction[];
}

export interface Headline {
  value: string;
  label: string;
}

export interface WidgetData {
  tileId: string;
  widget: WidgetKey;
  headline: Headline;
  items: BoardItem[];
  // How many there are in all (items may be a capped list).
  total: number;
  // The most urgent severity among the items; null when there's nothing.
  severity: Severity | null;
  // Smart stack: its children, most urgent first.
  stack?: WidgetData[];
  error?: string;
}

export interface Clock {
  now: Date;
  today: DayKey;
  timeZone: string;
}

export function clockFor(now: Date, timeZone: string): Clock {
  return { now, today: toDayKey(now, timeZone), timeZone };
}

const dayOf = (due: string, tz: string): DayKey => (due.length === 10 ? (due as DayKey) : toDayKey(new Date(due), tz));
// When a due value ends: a time is a moment; a date lasts the whole day.
const endOf = (due: string, tz: string): Date => (due.length === 10 ? startOfDayUtc(addDays(due as DayKey, 1), tz) : new Date(due));

// Overdue if its moment (or whole day) has passed, today if it's today,
// soon if within 48 hours, otherwise informational.
export function severityFor(due: string | null, clock: Clock, fallback: Severity = "info"): Severity {
  if (!due) return fallback;
  const day = dayOf(due, clock.timeZone);
  if (endOf(due, clock.timeZone) <= clock.now || day < clock.today) return "overdue";
  if (day === clock.today) return "today";
  if (new Date(due.length === 10 ? startOfDayUtc(day, clock.timeZone) : due).getTime() - clock.now.getTime() <= 48 * 3_600_000) return "soon";
  return "info";
}

export function dueLabel(due: string | null, clock: Clock): string | null {
  if (!due) return null;
  const day = dayOf(due, clock.timeZone);
  const time = due.length === 10 ? "" : ` ${formatTime(new Date(due), clock.timeZone)}`;
  const when = day === clock.today ? `Today${time}` : day === addDays(clock.today, 1) ? `Tomorrow${time}` : day === addDays(clock.today, -1) ? `Yesterday${time}` : `${formatDay(day, "short")}${time}`;
  return severityFor(due, clock) === "overdue" ? `Overdue · ${when}` : when;
}

// The end of a tile's window. Overdue items are always in it.
export function windowEnd(window: TileWindow, clock: Clock): Date {
  switch (window) {
    case "overdue":
      return clock.now;
    case "today":
      return startOfDayUtc(addDays(clock.today, 1), clock.timeZone);
    case "48h":
      return new Date(clock.now.getTime() + 48 * 3_600_000);
    case "week":
      return startOfDayUtc(addDays(clock.today, 8), clock.timeZone);
  }
}

export function inWindow(item: Pick<BoardItem, "due" | "severity">, window: TileWindow, clock: Clock): boolean {
  if (item.severity === "overdue") return true;
  if (window === "overdue") return false;
  if (!item.due) return true;
  const start = item.due.length === 10 ? startOfDayUtc(item.due as DayKey, clock.timeZone) : new Date(item.due);
  return start < windowEnd(window, clock);
}

export function sortItems<T extends Pick<BoardItem, "severity" | "due" | "id">>(items: T[], clock: Clock): T[] {
  const key = (i: T) => (i.due ? (i.due.length === 10 ? startOfDayUtc(i.due as DayKey, clock.timeZone).toISOString() : i.due) : "9999");
  return [...items].sort((a, b) => RANK[a.severity] - RANK[b.severity] || key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
}

export function topSeverity(items: Pick<BoardItem, "severity">[]): Severity | null {
  return items.reduce<Severity | null>((top, i) => (top === null || RANK[i.severity] < RANK[top] ? i.severity : top), null);
}

export function moreUrgent(a: Severity | null, b: Severity | null): number {
  return (a === null ? 9 : RANK[a]) - (b === null ? 9 : RANK[b]);
}

// A Needs-attention entry as a board item. Critical problems (conflicts,
// failed deliveries) count as overdue whatever their date.
export function fromAttention(a: AttentionItem, clock: Clock): BoardItem {
  const fallback: Severity = a.severity === "critical" ? "overdue" : a.severity === "warning" ? "today" : "info";
  const dated = a.overdue ? "overdue" : severityFor(a.dueAt, clock, fallback);
  const severity = a.severity === "critical" ? "overdue" : RANK[fallback] < RANK[dated] ? fallback : dated;
  return {
    id: a.id,
    title: a.title,
    subtitle: [a.subject, a.detail].filter(Boolean).join(" · ") || null,
    due: a.dueAt,
    dueLabel: dueLabel(a.dueAt, clock),
    severity,
    href: a.href,
    actions: [{ kind: "open", label: a.actionLabel, href: a.href }],
  };
}
