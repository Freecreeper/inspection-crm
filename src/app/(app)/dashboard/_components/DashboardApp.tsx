"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { DayKey } from "@/lib/calendar/time";
import { layoutRows } from "@/lib/dashboard/layout";
import { effectiveOptions, visibleWidgets, type DashboardPreferences } from "@/lib/dashboard/preferences";
import type { KpiDef, OptionalAttentionCategory, WidgetDef, WidgetKey } from "@/lib/dashboard/registry";
import type { WidgetResult } from "@/lib/dashboard/types";
import { getSchedulingOptions, type SchedulingOptions } from "../../calendar/actions";
import { AddTaskDialog, CancelDialog, RescheduleDialog, whenLabel, type RescheduleTarget } from "../../calendar/_components/ChangeDialogs";
import { PreviewDrawer, type Viewer } from "../../calendar/_components/PreviewDrawer";
import type { InspectionPreview } from "@/lib/calendar/preview";
import { ScheduleDialog } from "../../calendar/_components/ScheduleDialog";
import { restoreDashboardDefaults, saveDashboardPreferences } from "../actions";
import { CustomizePanel, type SaveStatus } from "./CustomizePanel";
import { GlobalSearch } from "./GlobalSearch";
import { NewCustomerDialog, NewMenu, type NewAction } from "./NewMenu";
import {
  ActivityWidget,
  AttentionWidget,
  FollowUpsWidget,
  InvoicesWidget,
  LeadsWidget,
  ReportsWidget,
  SnapshotWidget,
  TasksWidget,
  TodayWidget,
  UpcomingWidget,
  WidgetError,
  WidgetSkeleton,
  type OpenPreview,
} from "./widgets";

const SAVE_DELAY_MS = 400;

type Dialog =
  | { kind: "schedule" }
  | { kind: "task" }
  | { kind: "customer" }
  | { kind: "reschedule"; target: RescheduleTarget }
  | { kind: "cancel"; preview: InspectionPreview };

// A CalendarEvent stub is all the shared preview drawer needs to load an
// inspection or task by id.
function previewEvent(type: "inspection" | "task", id: string, title: string): CalendarEvent {
  return {
    id: `${type}:${id}`,
    type,
    layer: type === "inspection" ? "inspections" : "tasks",
    sourceType: type === "inspection" ? "Inspection" : "Task",
    sourceId: id,
    title,
    subtitle: null,
    start: null,
    end: null,
    allDay: type === "task",
    day: "",
    inspectorId: null,
    inspectorName: null,
    status: null,
    priority: "normal",
    warnings: [],
    href: type === "inspection" ? `/inspections/${id}` : "/tasks",
    searchText: "",
    movable: false,
  };
}

export function DashboardApp({
  greeting,
  dateLabel,
  today,
  timeZone,
  defaultDurationMinutes,
  initialPreferences,
  defaults,
  widgets,
  kpis,
  attention,
  data,
  viewer,
  canWriteCrm,
  canSearch,
  canViewReports,
}: {
  greeting: string;
  dateLabel: string;
  today: DayKey;
  timeZone: string;
  defaultDurationMinutes: number;
  initialPreferences: DashboardPreferences;
  defaults: DashboardPreferences;
  widgets: WidgetDef[];
  kpis: KpiDef[];
  attention: { required: { key: string; label: string }[]; optional: { key: OptionalAttentionCategory; label: string }[] };
  data: Partial<Record<WidgetKey, WidgetResult>>;
  viewer: Viewer & { userId: string };
  canWriteCrm: boolean;
  canSearch: boolean;
  canViewReports: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [prefs, setPrefs] = useState(initialPreferences);
  const [saved, setSaved] = useState(initialPreferences);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [customizing, setCustomizing] = useState(false);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [options, setOptions] = useState<SchedulingOptions | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSeq = useRef(0);

  const defs = new Map(widgets.map((w) => [w.key, w]));
  const refresh = () => startRefresh(() => router.refresh());

  // --- Preferences: apply immediately, save automatically -----------------

  async function persist(next: DashboardPreferences) {
    const seq = ++saveSeq.current;
    setStatus({ kind: "saving" });
    try {
      const result = await saveDashboardPreferences(next);
      if (seq !== saveSeq.current) return; // a newer change is on its way
      if (result.ok) {
        setSaved(result.data);
        setStatus({ kind: "saved" });
        // Newly shown widgets / KPIs / filters need fresh data from the server.
        refresh();
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    } catch {
      if (seq === saveSeq.current) setStatus({ kind: "error", message: "The server couldn't be reached." });
    }
  }

  function change(next: DashboardPreferences) {
    setPrefs(next);
    setStatus({ kind: "saving" });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(next), SAVE_DELAY_MS);
  }

  async function restore() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const seq = ++saveSeq.current;
    setStatus({ kind: "saving" });
    try {
      const result = await restoreDashboardDefaults();
      if (seq !== saveSeq.current) return;
      if (result.ok) {
        setPrefs(result.data);
        setSaved(result.data);
        setStatus({ kind: "saved", message: "Default dashboard restored" });
        refresh();
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    } catch {
      setStatus({ kind: "error", message: "The server couldn't be reached." });
    }
  }

  function undo() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveSeq.current++;
    setPrefs(saved);
    setStatus({ kind: "idle" });
  }

  // --- Preview drawer & dialogs (shared with the Calendar) ----------------

  async function ensureOptions(): Promise<SchedulingOptions | null> {
    if (options) return options;
    try {
      const loaded = await getSchedulingOptions();
      setOptions(loaded);
      return loaded;
    } catch {
      setNotice("Couldn't load scheduling options. Try again.");
      return null;
    }
  }

  const openPreview: OpenPreview = (target) => {
    if (target.type === "event" && target.event) setSelected(target.event);
    else if (target.type === "inspection" || target.type === "task") setSelected(previewEvent(target.type, target.id, target.title));
  };

  async function onNew(action: NewAction) {
    if (action === "customer") return setDialog({ kind: "customer" });
    if (await ensureOptions()) setDialog({ kind: action });
  }

  function afterChange(message?: string) {
    setDialog(null);
    if (message) setNotice(message);
    refresh();
  }

  // --- Rendering ------------------------------------------------------------

  const visible = visibleWidgets(prefs).filter((k) => defs.has(k));
  const rows = layoutRows(visible);

  function renderWidget(key: WidgetKey) {
    const def = defs.get(key)!;
    // The Business Snapshot renders from the user's KPI choice right away;
    // values fill in once the server has calculated them.
    if (key === "snapshot") {
      const result = data.snapshot;
      if (result && "error" in result) return <WidgetError title={def.label} message={result.error} />;
      return <SnapshotWidget kpis={prefs.kpis} values={result && "kpis" in result ? result.kpis : null} canViewReports={canViewReports} />;
    }
    const result = data[key];
    if (!result) return <WidgetSkeleton title={def.label} />;
    if ("error" in result) return <WidgetError title={def.label} message={result.error} />;
    const scope = effectiveOptions(prefs, key).scope;
    switch (result.key) {
      case "today":
        return <TodayWidget data={result} timeZone={timeZone} showInspector={scope === "all"} onOpen={openPreview} />;
      case "needsAttention":
        return <AttentionWidget data={result} onOpen={openPreview} />;
      case "upcoming":
        return <UpcomingWidget data={result} today={today} />;
      case "recentActivity":
        return <ActivityWidget data={result} today={today} timeZone={timeZone} />;
      case "myTasks":
        return <TasksWidget data={result} title={scope === "mine" ? "My Tasks" : "Open Tasks"} today={today} canComplete={viewer.canUpdateTasks} onOpen={openPreview} onChanged={refresh} />;
      case "reportsPending":
        return <ReportsWidget data={result} />;
      case "outstandingInvoices":
        return <InvoicesWidget data={result} today={today} />;
      case "realtorFollowUps":
        return <FollowUpsWidget data={result} today={today} onOpen={openPreview} />;
      case "leadActivity":
        return <LeadsWidget data={result} today={today} />;
      default:
        return null;
    }
  }

  return (
    <div className={customizing ? "lg:pr-[28rem]" : undefined}>
      <h1 className="sr-only">Dashboard</h1>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{greeting}</p>
          <p className="text-lg font-semibold text-slate-900">{dateLabel}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {canSearch && <GlobalSearch />}
          <button
            type="button"
            onClick={() => setCustomizing(true)}
            aria-expanded={customizing}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Customize
            <span className="sr-only"> Dashboard</span>
          </button>
          <NewMenu canSchedule={viewer.canSchedule} canWriteCrm={canWriteCrm} canAddTask={viewer.canUpdateTasks} onAction={onNew} />
        </div>
      </header>

      {notice && (
        <p role="status" className="mt-3 flex items-center justify-between rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="rounded p-0.5 hover:bg-emerald-100">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {refreshing ? "Updating dashboard…" : ""}
      </p>

      <div className={`mt-4 space-y-4 transition-opacity ${refreshing ? "opacity-80" : ""}`}>
        {visible.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            Every widget is hidden.{" "}
            <button type="button" onClick={() => setCustomizing(true)} className="font-medium text-emerald-700 hover:underline">
              Customize the Dashboard
            </button>{" "}
            to show some.
          </div>
        )}
        {rows.map((row) =>
          row.length === 2 ? (
            <div key={row.join("+")} className="grid gap-4 lg:grid-cols-2">
              {row.map((key) => (
                <div key={key} data-widget={key}>
                  {renderWidget(key)}
                </div>
              ))}
            </div>
          ) : (
            <div key={row[0]} data-widget={row[0]}>
              {renderWidget(row[0])}
            </div>
          )
        )}
      </div>

      <CustomizePanel
        open={customizing}
        onClose={() => setCustomizing(false)}
        prefs={prefs}
        defaults={defaults}
        widgets={widgets}
        kpis={kpis}
        attention={attention}
        status={status}
        onChange={change}
        onRestore={restore}
        onRetry={() => persist(prefs)}
        onUndo={undo}
      />

      <PreviewDrawer
        event={selected}
        timeZone={timeZone}
        viewer={viewer}
        onClose={() => setSelected(null)}
        onChanged={refresh}
        onReschedule={async (p) => {
          if (!(await ensureOptions())) return;
          setDialog({ kind: "reschedule", target: { inspectionId: p.id, address: p.address, day: p.day ?? today, time: p.time ?? "09:00", durationMinutes: p.durationMinutes, inspectorId: p.inspector?.id ?? null } });
        }}
        onCancel={(p) => setDialog({ kind: "cancel", preview: p })}
      />

      {dialog?.kind === "schedule" && options && (
        <ScheduleDialog
          initialDay={today}
          initialTime="09:00"
          options={options}
          timeZone={timeZone}
          defaultDurationMinutes={defaultDurationMinutes}
          defaultInspectorId={viewer.role === "INSPECTOR" ? viewer.userId : null}
          onClose={() => setDialog(null)}
          onScheduled={() => afterChange("Inspection scheduled. The confirmation email follows your automation settings.")}
        />
      )}
      {dialog?.kind === "task" && options && <AddTaskDialog initialDay={today} people={options.inspectors} onClose={() => setDialog(null)} onDone={() => afterChange("Task added.")} />}
      {dialog?.kind === "customer" && <NewCustomerDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "reschedule" && options && (
        <RescheduleDialog target={dialog.target} proposed={null} options={options} timeZone={timeZone} onClose={() => setDialog(null)} onDone={() => afterChange("Inspection rescheduled.")} />
      )}
      {dialog?.kind === "cancel" && (
        <CancelDialog
          inspectionId={dialog.preview.id}
          address={dialog.preview.address}
          when={whenLabel(dialog.preview.day, dialog.preview.start, timeZone)}
          onClose={() => setDialog(null)}
          onDone={() => afterChange("Inspection cancelled. It stays in the record as cancelled.")}
        />
      )}
    </div>
  );
}
