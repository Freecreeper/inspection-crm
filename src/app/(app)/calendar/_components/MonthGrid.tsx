"use client";

import { AlertTriangle } from "lucide-react";
import type { CalendarEvent } from "@/lib/calendar/types";
import { eachDay, formatDay, formatTime, type DayKey } from "@/lib/calendar/time";
import { EVENT_KIND, EventIcon, eventTone } from "./eventStyle";

const MAX_PER_CELL = 3;

// Planning view: a compact line per event, never full details. Anything
// beyond three in a day collapses to "+N more", which opens that day.
export function MonthGrid({
  start,
  end,
  month,
  events,
  timeZone,
  today,
  onEventClick,
  onOpenDay,
  onSlotClick,
}: {
  start: DayKey;
  end: DayKey;
  month: string; // "YYYY-MM"
  events: CalendarEvent[];
  timeZone: string;
  today: DayKey;
  onEventClick: (event: CalendarEvent) => void;
  onOpenDay: (day: DayKey) => void;
  onSlotClick: ((day: DayKey, time: string) => void) | null;
}) {
  const days = eachDay(start, end);
  const byDay = new Map<DayKey, CalendarEvent[]>();
  for (const e of events) {
    const list = byDay.get(e.day) ?? [];
    list.push(e);
    byDay.set(e.day, list);
  }
  // Inspections first, then deadlines, then the rest — the month view is for planning.
  const rank = (e: CalendarEvent) => (e.type === "inspection" ? 0 : e.priority === "high" ? 1 : e.allDay ? 2 : 3);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border bg-surface-secondary">
        {days.slice(0, 7).map((d) => (
          <div key={d} className="px-2 py-1.5 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {formatDay(d, "weekday")}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const list = (byDay.get(day) ?? []).slice().sort((a, b) => rank(a) - rank(b) || (a.start ?? "").localeCompare(b.start ?? ""));
          const shown = list.slice(0, MAX_PER_CELL);
          const inMonth = day.startsWith(month);
          return (
            <div
              key={day}
              onClick={(e) => {
                if (onSlotClick && e.target === e.currentTarget) onSlotClick(day, "09:00");
              }}
              className={`min-h-28 border-b border-r border-neutral-100 p-1.5 [&:nth-child(7n)]:border-r-0 ${inMonth ? "" : "bg-neutral-50/70"} ${onSlotClick ? "cursor-cell" : ""}`}
            >
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                aria-label={`Open ${formatDay(day, "long")}`}
                className={`mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${
                  day === today ? "bg-accent text-accent-foreground" : inMonth ? "text-neutral-800 hover:bg-neutral-100" : "text-subtle hover:bg-neutral-100"
                }`}
              >
                {formatDay(day, "dayNumber")}
              </button>
              <ul className="space-y-0.5">
                {shown.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onEventClick(e)}
                      className={`flex w-full items-center gap-1 truncate rounded border-l-[3px] px-1 py-0.5 text-left text-[11px] leading-4 ${eventTone(e)} hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring`}
                    >
                      <EventIcon event={e} className="h-3 w-3" />
                      <span className="sr-only">{EVENT_KIND[e.type].label}: </span>
                      {e.start && !e.allDay && <span className="shrink-0 tabular-nums text-muted-foreground">{formatTime(new Date(e.start), timeZone).replace(":00", "").replace(" ", "").toLowerCase()}</span>}
                      <span className="truncate">{e.title}</span>
                      {e.warnings.length > 0 && (
                        <>
                          <AlertTriangle className="ml-auto h-3 w-3 shrink-0 text-warning-strong" aria-hidden="true" />
                          <span className="sr-only">has warnings</span>
                        </>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {list.length > MAX_PER_CELL && (
                <button type="button" onClick={() => onOpenDay(day)} className="mt-0.5 text-[11px] font-medium text-neutral-600 hover:text-foreground hover:underline">
                  +{list.length - MAX_PER_CELL} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
