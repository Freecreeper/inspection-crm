"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { ClientCalendarConfig } from "@/lib/calendar/config";
import { formatDay, formatTime, minutesIntoDay, minutesToTime, toDayKey, type DayKey } from "@/lib/calendar/time";
import { EVENT_KIND, EventIcon, eventTone } from "./eventStyle";

const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const SNAP = 15;

interface Placed {
  event: CalendarEvent;
  top: number; // minutes from grid start
  height: number; // minutes
  lane: number;
  lanes: number;
}

// Side-by-side lanes for overlapping events within one day.
function layoutDay(events: CalendarEvent[], day: DayKey, gridStartMin: number, tz: string): Placed[] {
  const items = events
    .map((event) => {
      const start = new Date(event.start!);
      const end = new Date(event.end!);
      // An event that started the day before begins at midnight here.
      const startMin = toDayKey(start, tz) < day ? 0 : minutesIntoDay(start, tz);
      const endMin = toDayKey(end, tz) > day ? 24 * 60 : Math.max(minutesIntoDay(end, tz), startMin + 15);
      return { event, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const placed: Placed[] = [];
  let cluster: { item: (typeof items)[number]; lane: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) placed.push({ event: c.item.event, top: c.item.startMin - gridStartMin, height: c.item.endMin - c.item.startMin, lane: c.lane, lanes });
    cluster = [];
  };
  for (const item of items) {
    if (item.startMin >= clusterEnd && cluster.length) flush();
    const laneEnds: number[] = [];
    for (const c of cluster) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? 0, c.item.endMin);
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) lane = laneEnds.length;
    cluster.push({ item, lane });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  if (cluster.length) flush();
  return placed;
}

interface DragState {
  event: CalendarEvent;
  pointerId: number;
  originX: number;
  originY: number;
  originDay: DayKey;
  originMin: number;
  day: DayKey;
  min: number;
  moved: boolean;
}

export function TimeGrid({
  days,
  events,
  config,
  variant,
  today,
  now,
  onEventClick,
  onSlotClick,
  onDrop,
}: {
  days: DayKey[];
  events: CalendarEvent[];
  config: ClientCalendarConfig;
  variant: "day" | "week";
  today: DayKey;
  now: Date;
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: ((day: DayKey, time: string) => void) | null;
  onDrop: ((event: CalendarEvent, day: DayKey, time: string) => void) | null;
}) {
  const tz = config.timeZone;
  const timed = events.filter((e) => !e.allDay);
  const allDay = events.filter((e) => e.allDay);

  // Show business hours, stretched to fit anything scheduled outside them.
  const [gridStartMin, gridEndMin] = useMemo(() => {
    let lo = config.dayStartHour * 60;
    let hi = config.dayEndHour * 60;
    for (const e of timed) {
      const s = new Date(e.start!);
      const en = new Date(e.end!);
      if (days.includes(toDayKey(s, tz))) lo = Math.min(lo, Math.floor(minutesIntoDay(s, tz) / 60) * 60);
      if (days.includes(toDayKey(en, tz)) && toDayKey(en, tz) === toDayKey(s, tz)) hi = Math.max(hi, Math.ceil(minutesIntoDay(en, tz) / 60) * 60);
    }
    return [lo, Math.max(hi, lo + 60)];
  }, [timed, days, tz, config.dayStartHour, config.dayEndHour]);

  const placedByDay = useMemo(() => {
    const map = new Map<DayKey, Placed[]>();
    for (const day of days) {
      const dayEvents = timed.filter((e) => toDayKey(new Date(e.start!), tz) <= day && toDayKey(new Date(e.end!), tz) >= day && !(toDayKey(new Date(e.end!), tz) === day && minutesIntoDay(new Date(e.end!), tz) === 0 && toDayKey(new Date(e.start!), tz) < day));
      map.set(day, layoutDay(dayEvents, day, gridStartMin, tz));
    }
    return map;
  }, [days, timed, tz, gridStartMin]);

  const hours: number[] = [];
  for (let m = gridStartMin; m < gridEndMin; m += 60) hours.push(m);
  const heightPx = (gridEndMin - gridStartMin) * PX_PER_MIN;

  const columnsRef = useRef<Map<DayKey, HTMLDivElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  // Open scrolled to the start of business hours (or now, for today).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const focusMin = days.includes(today) ? Math.max(gridStartMin, minutesIntoDay(now, tz) - 90) : config.dayStartHour * 60;
    el.scrollTop = Math.max(0, (focusMin - gridStartMin) * PX_PER_MIN);
    // Only when the visible days change, not on every event refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(",")]);

  // Dragging snaps to the nearest quarter hour; clicking picks the quarter
  // hour the click landed in.
  function slotFromPoint(clientX: number, clientY: number, mode: "round" | "floor" = "round"): { day: DayKey; min: number } | null {
    for (const [day, el] of columnsRef.current) {
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX < rect.right) {
        const raw = (clientY - rect.top) / PX_PER_MIN + gridStartMin;
        const snapped = (mode === "floor" ? Math.floor(raw / SNAP) : Math.round(raw / SNAP)) * SNAP;
        const min = Math.max(0, Math.min(24 * 60 - SNAP, snapped));
        return { day, min };
      }
    }
    return null;
  }

  function startDrag(e: React.PointerEvent, event: CalendarEvent) {
    if (!onDrop || !event.movable || e.button !== 0) return;
    const start = new Date(event.start!);
    const state: DragState = {
      event,
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      originDay: toDayKey(start, tz),
      originMin: minutesIntoDay(start, tz),
      day: toDayKey(start, tz),
      min: minutesIntoDay(start, tz),
      moved: false,
    };
    dragRef.current = state;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.originX, e.clientY - d.originY) < 6) return;
    const deltaMin = Math.round((e.clientY - d.originY) / PX_PER_MIN / SNAP) * SNAP;
    const over = slotFromPoint(e.clientX, e.clientY);
    const next = { ...d, moved: true, day: over?.day ?? d.day, min: Math.max(0, Math.min(24 * 60 - SNAP, d.originMin + deltaMin)) };
    dragRef.current = next;
    setDrag(next);
  }

  function endDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    if (!d.moved) return; // a plain click; the click handler opens the preview
    suppressClick.current = true;
    if (d.day !== d.originDay || d.min !== d.originMin) onDrop?.(d.event, d.day, minutesToTime(d.min));
  }

  const nowMin = minutesIntoDay(now, tz);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      {/* Day headers + all-day row */}
      <div className="grid border-b border-slate-200" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="border-r border-slate-100" />
        {days.map((day) => (
          <div key={day} className="border-r border-slate-100 px-1.5 py-2 last:border-r-0">
            <p className={`text-center text-xs font-medium uppercase tracking-wide ${day === today ? "text-emerald-700" : "text-slate-500"}`}>
              {variant === "day" ? formatDay(day, "long") : formatDay(day, "weekday")}
              {variant === "week" && (
                <span className={`ml-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm ${day === today ? "bg-emerald-600 text-white" : "text-slate-900"}`}>
                  {formatDay(day, "dayNumber")}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>
      {allDay.length > 0 && (
        <div className="grid border-b border-slate-200 bg-slate-50/60" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="border-r border-slate-100 px-1 py-1.5 text-right text-[10px] uppercase tracking-wide text-slate-400">All day</div>
          {days.map((day) => (
            <div key={day} className="space-y-1 border-r border-slate-100 p-1 last:border-r-0">
              {allDay
                .filter((e) => e.day === day)
                .map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onEventClick(e)}
                    className={`flex w-full items-center gap-1 truncate rounded border-l-[3px] px-1.5 py-0.5 text-left text-xs ${eventTone(e)} hover:brightness-95 focus-visible:outline-2 focus-visible:outline-emerald-600`}
                  >
                    <EventIcon event={e} className="h-3 w-3" />
                    <span className="sr-only">{EVENT_KIND[e.type].label}: </span>
                    <span className="truncate">{e.title}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      {/* Timed grid */}
      <div ref={scrollRef} className="max-h-[calc(100vh-17rem)] min-h-[24rem] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="relative border-r border-slate-100" style={{ height: heightPx }}>
            {hours.map((m) => (
              <span key={m} className="absolute right-1.5 -translate-y-1/2 text-[11px] tabular-nums text-slate-400" style={{ top: (m - gridStartMin) * PX_PER_MIN }}>
                {m === gridStartMin ? "" : formatTime(new Date(Date.UTC(2000, 0, 1, m / 60)), "UTC")}
              </span>
            ))}
          </div>
          {days.map((day) => (
            <div
              key={day}
              ref={(el) => {
                if (el) columnsRef.current.set(day, el);
                else columnsRef.current.delete(day);
              }}
              className={`relative border-r border-slate-100 last:border-r-0 ${onSlotClick ? "cursor-cell" : ""}`}
              style={{ height: heightPx }}
              onClick={(e) => {
                if (!onSlotClick || e.target !== e.currentTarget) return;
                const slot = slotFromPoint(e.clientX, e.clientY, "floor");
                if (slot) onSlotClick(day, minutesToTime(slot.min));
              }}
            >
              {hours.map((m) => (
                <div key={m} aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-slate-100" style={{ top: (m - gridStartMin) * PX_PER_MIN }} />
              ))}
              {day === today && nowMin >= gridStartMin && nowMin <= gridEndMin && (
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-rose-500" style={{ top: (nowMin - gridStartMin) * PX_PER_MIN }} />
              )}
              {(placedByDay.get(day) ?? []).map((p) => {
                const e = p.event;
                const dragging = drag?.event.id === e.id;
                const start = new Date(e.start!);
                const end = new Date(e.end!);
                const warn = e.warnings.length > 0;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onPointerDown={(ev) => startDrag(ev, e)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={() => {
                      dragRef.current = null;
                      setDrag(null);
                    }}
                    onClick={() => {
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        return;
                      }
                      onEventClick(e);
                    }}
                    aria-label={`${EVENT_KIND[e.type].label}: ${e.title}, ${formatTime(start, tz)} to ${formatTime(end, tz)}${e.inspectorName ? `, ${e.inspectorName}` : ""}${warn ? `. Warnings: ${e.warnings.map((w) => w.label).join(", ")}` : ""}`}
                    className={`absolute flex flex-col items-stretch justify-start overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-xs shadow-sm ${eventTone(e)} ${e.movable && onDrop ? "cursor-grab touch-none" : ""} ${dragging ? "opacity-40" : "hover:brightness-95"} focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-emerald-600`}
                    style={{
                      top: p.top * PX_PER_MIN + 1,
                      height: Math.max(p.height * PX_PER_MIN - 2, 18),
                      left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`,
                      width: `calc(${100 / p.lanes}% - 4px)`,
                    }}
                  >
                    <span className="flex items-center gap-1 font-medium">
                      <EventIcon event={e} className="h-3 w-3" />
                      <span className="tabular-nums">{formatTime(start, tz)}</span>
                      {warn && <AlertTriangle className="ml-auto h-3 w-3 shrink-0 text-amber-600" aria-hidden="true" />}
                    </span>
                    <span className="block truncate font-medium">{e.title}</span>
                    {e.subtitle && p.height >= 60 && <span className="block truncate text-slate-600">{e.subtitle}</span>}
                    {e.inspectorName && e.type === "inspection" && p.height >= 90 && <span className="block truncate text-slate-500">Inspector: {e.inspectorName}</span>}
                    {variant === "day" && warn && p.height >= 75 && (
                      <span className="mt-0.5 block truncate text-amber-800">⚠ {e.warnings.map((w) => w.label).join(" · ")}</span>
                    )}
                  </button>
                );
              })}
              {drag && drag.day === day && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-1 z-20 rounded-md border-2 border-dashed border-emerald-600 bg-emerald-100/70 px-1.5 py-1 text-xs font-medium text-emerald-900"
                  style={{
                    top: (drag.min - gridStartMin) * PX_PER_MIN,
                    height: Math.max(((new Date(drag.event.end!).getTime() - new Date(drag.event.start!).getTime()) / 60_000) * PX_PER_MIN, 18),
                  }}
                >
                  {formatTime(new Date(Date.UTC(2000, 0, 1, Math.floor(drag.min / 60), drag.min % 60)), "UTC")}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
