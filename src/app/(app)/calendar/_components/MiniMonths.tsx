"use client";

import type { CalendarEvent } from "@/lib/calendar/types";
import { addDays, addMonths, eachDay, formatDay, formatMonth, startOfWeek, type DayKey } from "@/lib/calendar/time";

// Long-range planning: compact month calendars where each day shows how
// many inspections it has and whether anything else (a deadline, a task, a
// closing) falls on it. Details are one tap away — tapping a day opens it.
export function MiniMonths({
  months,
  events,
  today,
  weekStartsOn,
  onOpenDay,
  onOpenMonth,
  columns,
}: {
  months: string[]; // "YYYY-MM-01" day keys
  events: CalendarEvent[];
  today: DayKey;
  weekStartsOn: number;
  onOpenDay: (day: DayKey) => void;
  onOpenMonth?: (firstOfMonth: DayKey) => void;
  columns: 1 | 2;
}) {
  const byDay = new Map<DayKey, { inspections: number; other: number; urgent: boolean; titles: string[] }>();
  for (const e of events) {
    const entry = byDay.get(e.day) ?? { inspections: 0, other: 0, urgent: false, titles: [] };
    if (e.type === "inspection") entry.inspections++;
    else entry.other++;
    if (e.priority === "high" || e.warnings.length > 0) entry.urgent = true;
    entry.titles.push(e.title);
    byDay.set(e.day, entry);
  }

  return (
    <div className={`grid gap-4 ${columns === 2 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
      {months.map((first) => {
        const gridStart = startOfWeek(first, weekStartsOn);
        const nextMonth = addMonths(first, 1);
        const gridEnd = addDays(startOfWeek(addDays(nextMonth, -1), weekStartsOn), 7);
        const days = eachDay(gridStart, gridEnd);
        const month = first.slice(0, 7);
        const monthTotal = days.filter((d) => d.startsWith(month)).reduce((n, d) => n + (byDay.get(d)?.inspections ?? 0), 0);
        return (
          <section key={first} aria-label={formatMonth(first)} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
              {onOpenMonth ? (
                <button type="button" onClick={() => onOpenMonth(first)} className="text-sm font-semibold text-slate-900 hover:underline">
                  {formatMonth(first)}
                </button>
              ) : (
                <h3 className="text-sm font-semibold text-slate-900">{formatMonth(first)}</h3>
              )}
              <span className="text-xs text-slate-500">
                {monthTotal} inspection{monthTotal === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {days.slice(0, 7).map((d) => (
                <span key={d} className="py-1">
                  {formatDay(d, "weekday").slice(0, 2)}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {days.map((day) => {
                if (!day.startsWith(month)) return <span key={day} aria-hidden="true" />;
                const info = byDay.get(day);
                const label = [
                  formatDay(day, "long"),
                  info?.inspections ? `${info.inspections} inspection${info.inspections === 1 ? "" : "s"}` : null,
                  info?.other ? `${info.other} other event${info.other === 1 ? "" : "s"}` : null,
                  info?.urgent ? "needs attention" : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => onOpenDay(day)}
                    aria-label={label}
                    title={info ? info.titles.slice(0, 6).join("\n") : undefined}
                    className={`flex min-h-12 flex-col items-center gap-0.5 rounded-md px-0.5 py-1 text-xs hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-emerald-600 ${
                      day === today ? "ring-1 ring-emerald-600" : ""
                    }`}
                  >
                    <span className={`tabular-nums ${day === today ? "font-semibold text-emerald-700" : "text-slate-700"}`}>{formatDay(day, "dayNumber")}</span>
                    {info?.inspections ? (
                      <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold leading-4 text-emerald-800" aria-hidden="true">
                        {info.inspections}
                      </span>
                    ) : null}
                    {info?.other ? <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${info.urgent ? "bg-amber-500" : "bg-slate-400"}`} /> : null}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="text-xs text-slate-500 lg:col-span-2">
        <span className="mr-1 inline-block rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-800">2</span> inspections that day
        <span className="ml-3 mr-1 inline-block h-1.5 w-1.5 rounded-full bg-slate-400 align-middle" /> other events
        <span className="ml-3 mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" /> needs attention. Tap a day to open it.
      </p>
    </div>
  );
}
