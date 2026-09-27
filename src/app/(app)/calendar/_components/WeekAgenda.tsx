"use client";

import type { CalendarEvent } from "@/lib/calendar/types";
import { eachDay, formatDay, type DayKey } from "@/lib/calendar/time";
import { AgendaList } from "./AgendaList";

// The week on a phone: each day in order as a short agenda, instead of a
// seven-column grid that can't fit.
export function WeekAgenda({
  start,
  end,
  events,
  today,
  timeZone,
  onEventClick,
  onOpenDay,
}: {
  start: DayKey;
  end: DayKey;
  events: CalendarEvent[];
  today: DayKey;
  timeZone: string;
  onEventClick: (event: CalendarEvent) => void;
  onOpenDay: (day: DayKey) => void;
}) {
  return (
    <div className="space-y-5">
      {eachDay(start, end).map((day) => {
        const has = events.some((e) => e.day === day);
        return (
          <section key={day} aria-label={formatDay(day, "long")}>
            <button type="button" onClick={() => onOpenDay(day)} className={`mb-1.5 text-sm font-semibold hover:underline ${day === today ? "text-emerald-700" : "text-slate-900"}`}>
              {formatDay(day, "short")}
              {day === today && <span className="ml-1.5 text-xs font-medium">Today</span>}
            </button>
            {has ? <AgendaList day={day} events={events} timeZone={timeZone} onEventClick={onEventClick} /> : <p className="text-sm text-slate-400">Nothing scheduled.</p>}
          </section>
        );
      })}
    </div>
  );
}
