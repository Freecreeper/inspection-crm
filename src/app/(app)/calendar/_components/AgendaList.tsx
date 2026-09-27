"use client";

import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { CalendarEvent } from "@/lib/calendar/types";
import { formatDuration, formatTime, type DayKey } from "@/lib/calendar/time";
import { EVENT_KIND, EventIcon } from "./eventStyle";

// The execution view of a single day: what's happening, in order, with the
// warnings that matter and one tap to the preview or the record. Also the
// whole Calendar on phones, where a seven-column grid is unusable.
export function AgendaList({
  day,
  events,
  timeZone,
  onEventClick,
  emptyAction,
}: {
  day: DayKey;
  events: CalendarEvent[];
  timeZone: string;
  onEventClick: (event: CalendarEvent) => void;
  emptyAction?: React.ReactNode;
}) {
  // `day` is the business-time-zone day the event starts on.
  const list = events.filter((e) => e.day === day);
  const allDay = list.filter((e) => e.allDay);
  const timed = list.filter((e) => !e.allDay).sort((a, b) => a.start!.localeCompare(b.start!));

  if (list.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        Nothing scheduled.
        {emptyAction && <div className="mt-3">{emptyAction}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {allDay.length > 0 && (
        <section aria-label="All day">
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">All day</h3>
          <ul className="space-y-2">
            {allDay.map((e) => (
              <AgendaCard key={e.id} event={e} timeZone={timeZone} onClick={() => onEventClick(e)} />
            ))}
          </ul>
        </section>
      )}
      {timed.length > 0 && (
        <section aria-label="Scheduled">
          {allDay.length > 0 && <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Scheduled</h3>}
          <ul className="space-y-2">
            {timed.map((e) => (
              <AgendaCard key={e.id} event={e} timeZone={timeZone} onClick={() => onEventClick(e)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AgendaCard({ event: e, timeZone, onClick }: { event: CalendarEvent; timeZone: string; onClick: () => void }) {
  const start = e.start ? new Date(e.start) : null;
  const end = e.end ? new Date(e.end) : null;
  const minutes = start && end ? Math.round((end.getTime() - start.getTime()) / 60_000) : null;
  const accent = e.type === "inspection" ? "border-l-emerald-600" : e.priority === "high" ? "border-l-amber-500" : "border-l-slate-300";
  return (
    <li className={`rounded-lg border border-l-4 border-slate-200 bg-white ${accent}`}>
      <button type="button" onClick={onClick} className="flex w-full items-start gap-3 p-3 text-left focus-visible:outline-2 focus-visible:outline-emerald-600">
        <div className="w-16 shrink-0 pt-0.5 text-xs tabular-nums text-slate-600">
          {start && !e.allDay ? (
            <>
              <span className="block font-semibold text-slate-900">{formatTime(start, timeZone)}</span>
              {minutes && <span className="block text-slate-500">{formatDuration(minutes)}</span>}
            </>
          ) : (
            <span className="block text-slate-500">All day</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <EventIcon event={e} className="h-3.5 w-3.5" />
            {EVENT_KIND[e.type].label}
          </p>
          <p className="mt-0.5 font-medium text-slate-900">{e.title}</p>
          {e.subtitle && <p className="text-sm text-slate-600">{e.subtitle}</p>}
          {e.inspectorName && e.type !== "task" && <p className="text-sm text-slate-500">{e.type === "block" ? e.inspectorName : `Inspector: ${e.inspectorName}`}</p>}
          {e.warnings.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {e.warnings.map((w) => (
                <li key={w.code} className="flex items-center gap-1 text-sm text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {w.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      </button>
      {e.type === "inspection" && (
        <div className="border-t border-slate-100 px-3 py-2 text-right">
          <Link href={e.href} className="text-sm font-medium text-emerald-700 hover:underline">
            Open inspection
          </Link>
        </div>
      )}
    </li>
  );
}
