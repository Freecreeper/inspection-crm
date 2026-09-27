"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Layers, Plus, Search, X } from "lucide-react";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { ClientCalendarConfig } from "@/lib/calendar/config";
import { CALENDAR_LAYERS, type CalendarLayer, type CalendarPreferences } from "@/lib/calendar/layers";
import type { InspectionPreview } from "@/lib/calendar/preview";
import {
  CALENDAR_VIEWS,
  VIEW_LABELS,
  addMonths,
  eachDay,
  formatDay,
  formatMonth,
  minutesIntoDay,
  minutesToTime,
  shiftAnchor,
  startOfMonth,
  timeOfDay,
  toDayKey,
  viewRange,
  type CalendarView,
  type DayKey,
} from "@/lib/calendar/time";
import { getCalendarEvents, saveCalendarPreferences, type SchedulingOptions } from "../actions";
import { TimeGrid } from "./TimeGrid";
import { MonthGrid } from "./MonthGrid";
import { AgendaList } from "./AgendaList";
import { PreviewDrawer, type Viewer } from "./PreviewDrawer";
import { ScheduleDialog } from "./ScheduleDialog";
import { AddTaskDialog, BlockTimeDialog, CancelDialog, RescheduleDialog, whenLabel, type RescheduleTarget } from "./ChangeDialogs";
import { Popover } from "./Popover";
import { MiniMonths } from "./MiniMonths";
import { WeekAgenda } from "./WeekAgenda";

const btn = "inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600";
const iconBtn = "inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600";

function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with the real viewport after hydration
    setPhone(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPhone(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return phone;
}

type Dialog =
  | { kind: "schedule"; day: DayKey; time: string }
  | { kind: "reschedule"; target: RescheduleTarget; proposed: { day: DayKey; time: string } | null }
  | { kind: "cancel"; preview: InspectionPreview }
  | { kind: "block"; day: DayKey; time: string }
  | { kind: "task"; day: DayKey }
  | null;

function rangeLabel(view: CalendarView, anchor: DayKey, start: DayKey, end: DayKey) {
  if (view === "day") return formatDay(anchor, "long");
  if (view === "month") return formatMonth(anchor);
  if (view === "4month") {
    const first = startOfMonth(anchor);
    const last = addMonths(first, 3);
    const short = (d: DayKey, year: boolean) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
    return `${short(first, first.slice(0, 4) !== last.slice(0, 4))} – ${short(last, true)}`;
  }
  const last = eachDay(start, end).at(-1)!;
  const sameMonth = start.slice(0, 7) === last.slice(0, 7);
  const a = new Date(`${start}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const b = new Date(`${last}T12:00:00Z`).toLocaleDateString("en-US", { month: sameMonth ? undefined : "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${a} – ${b}`;
}

export function CalendarApp({
  config,
  initialPreferences,
  initialAnchor,
  initialView,
  initialEvents,
  today: initialToday,
  options,
  viewer,
}: {
  config: ClientCalendarConfig;
  initialPreferences: CalendarPreferences;
  initialAnchor: DayKey;
  initialView: CalendarView;
  initialEvents: CalendarEvent[];
  today: DayKey;
  options: SchedulingOptions;
  viewer: Viewer;
}) {
  const tz = config.timeZone;
  const isPhone = useIsPhone();
  const [view, setView] = useState<CalendarView>(initialView);
  const [anchor, setAnchor] = useState<DayKey>(initialAnchor);
  const [layers, setLayers] = useState<CalendarLayer[]>(initialPreferences.layers);
  const [inspectorId, setInspectorId] = useState<string | null>(initialPreferences.inspectorId);
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState<string | null>(null);

  // Every view is available at every width; on phones each one renders in
  // a form that fits (agenda lists and compact month calendars) instead of
  // shrinking the seven-column grid.
  const effectiveView: CalendarView = view;
  const today = toDayKey(now, tz) || initialToday;
  const { start, end } = viewRange(effectiveView, anchor, config.weekStartsOn);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Range-bounded fetch whenever the visible range or filters change.
  const requestRef = useRef(0);
  const firstLoad = useRef(true);
  const refresh = useCallback(async () => {
    const r = ++requestRef.current;
    setLoading(true);
    try {
      const result = await getCalendarEvents({ start, end, layers, inspectorId });
      if (r !== requestRef.current) return;
      if (result.ok) {
        setEvents(result.data);
        setLoadError(null);
      } else setLoadError(result.error);
    } catch {
      if (r === requestRef.current) setLoadError("Couldn't load the calendar. Check your connection and try again.");
    } finally {
      if (r === requestRef.current) setLoading(false);
    }
  }, [start, end, layers, inspectorId]);

  useEffect(() => {
    // The server already rendered the first range; skip refetching it.
    if (firstLoad.current && effectiveView === initialView) {
      firstLoad.current = false;
      return;
    }
    firstLoad.current = false;
    refresh();
  }, [refresh, effectiveView, initialView]);

  // Keep the view and date in the URL (shareable, survives reload) without
  // a server round trip.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    url.searchParams.set("date", anchor);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [view, anchor]);

  // Remember view, layers, and inspector filter for this user.
  const prefsKey = JSON.stringify({ view, layers, inspectorId });
  const savedKey = useRef(prefsKey);
  useEffect(() => {
    if (prefsKey === savedKey.current) return;
    const t = setTimeout(() => {
      savedKey.current = prefsKey;
      saveCalendarPreferences({ view, layers, inspectorId }).catch(() => undefined);
    }, 600);
    return () => clearTimeout(t);
  }, [prefsKey, view, layers, inspectorId]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => (q ? events.filter((e) => q.split(/\s+/).every((w) => e.searchText.includes(w))) : events), [events, q]);

  const afterChange = (message?: string) => {
    setDialog(null);
    setSelected(null);
    if (message) setNotice(message);
    refresh();
  };

  const canSchedule = viewer.canSchedule;
  const onSlotClick = canSchedule ? (day: DayKey, time: string) => setDialog({ kind: "schedule", day, time }) : null;
  const onDrop = viewer.canReschedule
    ? (event: CalendarEvent, day: DayKey, time: string) => {
        const startAt = new Date(event.start!);
        setDialog({
          kind: "reschedule",
          target: {
            inspectionId: event.sourceId,
            address: event.title,
            day: event.day,
            time: timeOfDay(startAt, tz),
            durationMinutes: Math.round((new Date(event.end!).getTime() - startAt.getTime()) / 60_000),
            inspectorId: event.inspectorId,
          },
          proposed: { day, time },
        });
      }
    : null;

  const defaultSlot = () => {
    const nextHour = Math.min(config.dayEndHour - 1, Math.max(config.dayStartHour, Math.floor(minutesIntoDay(now, tz) / 60) + 1));
    return { day: anchor < today && effectiveView === "day" ? today : anchor, time: minutesToTime(nextHour * 60) };
  };

  const openDay = (day: DayKey) => {
    setAnchor(day);
    setView("day");
  };
  const openMonth = (first: DayKey) => {
    setAnchor(first);
    setView("month");
  };

  // Swipe between days on phones.
  const touch = useRef<{ x: number; y: number } | null>(null);

  const people = options.inspectors;
  const title = rangeLabel(effectiveView, anchor, start, end);

  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">Calendar</h1>
          <p className="truncate text-sm font-medium text-slate-600" aria-live="polite">
            {title}
            {loading && <span className="ml-2 text-xs font-normal text-slate-400">Loading…</span>}
          </p>
        </div>
        {(canSchedule || viewer.canUpdateTasks || viewer.canBlockTime) && (
          <Popover
            label={
              <>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Schedule
              </>
            }
            buttonClassName="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            {(close) => (
              <div role="menu" aria-label="Schedule" className="flex flex-col">
                {[
                  canSchedule && { label: "Schedule inspection", run: () => setDialog({ kind: "schedule", ...defaultSlot() }) },
                  viewer.canUpdateTasks && { label: "Add task", run: () => setDialog({ kind: "task", day: defaultSlot().day }) },
                  viewer.canBlockTime && { label: "Block time", run: () => setDialog({ kind: "block", ...defaultSlot() }) },
                ]
                  .filter(Boolean)
                  .map((item) => {
                    const i = item as { label: string; run: () => void };
                    return (
                      <button
                        key={i.label}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          i.run();
                        }}
                        className="rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
                      >
                        {i.label}
                      </button>
                    );
                  })}
              </div>
            )}
          </Popover>
        )}
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAnchor(today)} className={btn}>
          Today
        </button>
        <div className="flex gap-1">
          <button type="button" aria-label={`Previous ${VIEW_LABELS[effectiveView].toLowerCase()}`} onClick={() => setAnchor((a) => shiftAnchor(effectiveView, a, -1))} className={iconBtn}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" aria-label={`Next ${VIEW_LABELS[effectiveView].toLowerCase()}`} onClick={() => setAnchor((a) => shiftAnchor(effectiveView, a, 1))} className={iconBtn}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {isPhone && (
          <input
            type="date"
            aria-label="Go to date"
            value={anchor}
            onChange={(e) => e.target.value && setAnchor(e.target.value)}
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
          />
        )}
        <nav aria-label="Calendar view" className="flex w-full rounded-lg bg-slate-100 p-0.5 sm:w-auto">
          {CALENDAR_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium sm:flex-none ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <label htmlFor="calendar-search" className="sr-only">
              Search the calendar
            </label>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              id="calendar-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this view"
              className="h-9 w-44 rounded-md border border-slate-300 bg-white pl-8 pr-7 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {people.length > 0 && (
            <label className="flex items-center">
              <span className="sr-only">Inspector</span>
              <select value={inspectorId ?? ""} onChange={(e) => setInspectorId(e.target.value || null)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700">
                <option value="">All inspectors</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Popover
            label={
              <>
                <Layers className="h-4 w-4" aria-hidden="true" />
                Layers
                <span className="rounded-full bg-slate-100 px-1.5 text-xs tabular-nums text-slate-600">{layers.length}</span>
              </>
            }
            buttonClassName={btn}
          >
            {() => (
              <fieldset className="px-2 py-1.5">
                <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">Show</legend>
                <div className="mt-1.5 space-y-1.5">
                  {CALENDAR_LAYERS.filter((l) => l.key !== "billing" || viewer.role !== "REPORTING_ANALYST" || true).map((l) => (
                    <label key={l.key} className="flex items-center gap-2 px-1 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={layers.includes(l.key)}
                        onChange={(e) => setLayers((current) => (e.target.checked ? CALENDAR_LAYERS.map((x) => x.key).filter((k) => k === l.key || current.includes(k)) : current.filter((k) => k !== l.key)))}
                      />
                      {l.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </Popover>
        </div>
      </div>

      {q && (
        <p className="mt-2 text-xs text-slate-500" aria-live="polite">
          {visible.length} match{visible.length === 1 ? "" : "es"} in this view.{" "}
          <button type="button" onClick={() => setQuery("")} className="underline">
            Clear
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 flex items-center justify-between rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="rounded p-0.5 hover:bg-emerald-100">
            <X className="h-4 w-4" />
          </button>
        </p>
      )}
      {loadError && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}{" "}
          <button type="button" onClick={() => refresh()} className="font-medium underline">
            Retry
          </button>
        </p>
      )}

      <div className="mt-4">
        {isPhone ? (
          <div
            onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
            onTouchEnd={(e) => {
              const t = touch.current;
              touch.current = null;
              if (!t) return;
              const dx = e.changedTouches[0].clientX - t.x;
              const dy = e.changedTouches[0].clientY - t.y;
              if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) setAnchor((a) => shiftAnchor(effectiveView, a, dx < 0 ? 1 : -1));
            }}
          >
            {effectiveView === "day" && (
              <AgendaList
                day={anchor}
                events={visible}
                timeZone={tz}
                onEventClick={setSelected}
                emptyAction={
                  canSchedule ? (
                    <button type="button" onClick={() => setDialog({ kind: "schedule", ...defaultSlot() })} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white">
                      Schedule inspection
                    </button>
                  ) : undefined
                }
              />
            )}
            {effectiveView === "week" && <WeekAgenda start={start} end={end} events={visible} today={today} timeZone={tz} onEventClick={setSelected} onOpenDay={openDay} />}
            {(effectiveView === "month" || effectiveView === "4month") && (
              <MiniMonths
                months={effectiveView === "month" ? [startOfMonth(anchor)] : [0, 1, 2, 3].map((i) => addMonths(startOfMonth(anchor), i))}
                events={visible}
                today={today}
                weekStartsOn={config.weekStartsOn}
                onOpenDay={openDay}
                onOpenMonth={effectiveView === "4month" ? openMonth : undefined}
                columns={1}
              />
            )}
          </div>
        ) : effectiveView === "4month" ? (
          <MiniMonths
            months={[0, 1, 2, 3].map((i) => addMonths(startOfMonth(anchor), i))}
            events={visible}
            today={today}
            weekStartsOn={config.weekStartsOn}
            onOpenDay={openDay}
            onOpenMonth={openMonth}
            columns={2}
          />
        ) : effectiveView === "month" ? (
          <MonthGrid
            start={start}
            end={end}
            month={anchor.slice(0, 7)}
            events={visible}
            timeZone={tz}
            today={today}
            onEventClick={setSelected}
            onOpenDay={openDay}
            onSlotClick={onSlotClick}
          />
        ) : effectiveView === "day" ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <TimeGrid days={[anchor]} events={visible} config={config} variant="day" today={today} now={now} onEventClick={setSelected} onSlotClick={onSlotClick} onDrop={onDrop} />
            <section aria-label="Day agenda">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Agenda</h2>
              <AgendaList day={anchor} events={visible} timeZone={tz} onEventClick={setSelected} />
            </section>
          </div>
        ) : (
          <TimeGrid days={eachDay(start, end)} events={visible} config={config} variant="week" today={today} now={now} onEventClick={setSelected} onSlotClick={onSlotClick} onDrop={onDrop} />
        )}
      </div>
      {!isPhone && (effectiveView === "day" || effectiveView === "week") && (canSchedule || onDrop) && (
        <p className="mt-2 text-xs text-slate-500">
          {canSchedule && "Click an empty time to schedule an inspection. "}
          {onDrop && "Drag an inspection to reschedule it — you'll confirm before anything changes. "}
          {onDrop && "Or open it and choose Reschedule."}
        </p>
      )}

      <PreviewDrawer
        event={selected}
        timeZone={tz}
        viewer={viewer}
        onClose={() => setSelected(null)}
        onChanged={() => refresh()}
        onReschedule={(p) =>
          setDialog({
            kind: "reschedule",
            target: { inspectionId: p.id, address: p.address, day: p.day ?? today, time: p.time ?? "09:00", durationMinutes: p.durationMinutes, inspectorId: p.inspector?.id ?? null },
            proposed: null,
          })
        }
        onCancel={(p) => setDialog({ kind: "cancel", preview: p })}
      />

      {dialog?.kind === "schedule" && (
        <ScheduleDialog
          initialDay={dialog.day}
          initialTime={dialog.time}
          options={options}
          timeZone={tz}
          defaultDurationMinutes={config.defaultDurationMinutes}
          defaultInspectorId={inspectorId ?? (viewer.role === "INSPECTOR" ? viewer.userId : null)}
          onClose={() => setDialog(null)}
          onScheduled={(day) => {
            setAnchor(day);
            afterChange("Inspection scheduled. The confirmation email follows your automation settings.");
          }}
        />
      )}
      {dialog?.kind === "reschedule" && (
        <RescheduleDialog target={dialog.target} proposed={dialog.proposed} options={options} timeZone={tz} onClose={() => setDialog(null)} onDone={() => afterChange("Inspection rescheduled.")} />
      )}
      {dialog?.kind === "cancel" && (
        <CancelDialog
          inspectionId={dialog.preview.id}
          address={dialog.preview.address}
          when={whenLabel(dialog.preview.day, dialog.preview.start, tz)}
          onClose={() => setDialog(null)}
          onDone={() => afterChange("Inspection cancelled. It stays in the record as cancelled.")}
        />
      )}
      {dialog?.kind === "block" && (
        <BlockTimeDialog
          initialDay={dialog.day}
          initialTime={dialog.time}
          people={viewer.role === "INSPECTOR" ? people.filter((p) => p.id === viewer.userId) : people}
          lockedUserId={viewer.role === "INSPECTOR" ? viewer.userId : null}
          onClose={() => setDialog(null)}
          onDone={() => afterChange("Time blocked.")}
        />
      )}
      {dialog?.kind === "task" && <AddTaskDialog initialDay={dialog.day} people={people} onClose={() => setDialog(null)} onDone={() => afterChange("Task added.")} />}
    </div>
  );
}
