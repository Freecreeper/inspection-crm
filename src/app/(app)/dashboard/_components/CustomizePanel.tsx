"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, GripVertical, Lock, RotateCcw } from "lucide-react";
import { Drawer } from "@/components/Drawer";
import { KPI_LIMIT, TIMEFRAME_LABELS, type KpiDef, type KpiKey, type OptionalAttentionCategory, type Scope, type Timeframe, type WidgetDef, type WidgetKey } from "@/lib/dashboard/registry";
import { moveShownWidget, setWidgetShown } from "@/lib/dashboard/layout";
import { effectiveOptions, samePreferences, type DashboardPreferences } from "@/lib/dashboard/preferences";

export type SaveStatus = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; message?: string } | { kind: "error"; message: string };

const heading = "text-sm font-semibold text-slate-900";
const hint = "mt-0.5 text-xs text-slate-500";
const iconButton =
  "flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-30 disabled:hover:bg-transparent";
const selectClass = "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700";

// Controlled customization: only the approved widgets, KPIs, and options
// the server says this user may use. Every change applies to the Dashboard
// immediately and saves itself; nothing here can add a widget or KPI the
// server didn't offer.
export function CustomizePanel({
  open,
  onClose,
  prefs,
  defaults,
  widgets,
  kpis,
  attention,
  status,
  onChange,
  onRestore,
  onRetry,
  onUndo,
}: {
  open: boolean;
  onClose: () => void;
  prefs: DashboardPreferences;
  defaults: DashboardPreferences;
  widgets: WidgetDef[];
  kpis: KpiDef[];
  attention: { required: { key: string; label: string }[]; optional: { key: OptionalAttentionCategory; label: string }[] };
  status: SaveStatus;
  onChange: (next: DashboardPreferences) => void;
  onRestore: () => Promise<void>;
  onRetry: () => void;
  onUndo: () => void;
}) {
  const [dragKey, setDragKey] = useState<WidgetKey | null>(null);
  const [overKey, setOverKey] = useState<WidgetKey | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const defs = new Map(widgets.map((w) => [w.key, w]));
  const rows = prefs.widgets.filter((w) => defs.has(w.key));
  const shown = rows.filter((w) => w.visible);
  const hidden = rows.filter((w) => !w.visible);
  const isDefault = samePreferences(prefs, defaults);
  const snapshotAvailable = defs.has("snapshot");
  const attentionAvailable = defs.has("needsAttention");

  const focusLater = (ids: string[]) =>
    requestAnimationFrame(() => {
      for (const id of ids) {
        const el = document.getElementById(id) as HTMLButtonElement | HTMLInputElement | null;
        if (el && !el.disabled) return el.focus();
      }
    });

  function move(key: WidgetKey, to: number, focusDirection?: "up" | "down") {
    const next = moveShownWidget(prefs.widgets, key, to);
    if (next === prefs.widgets) return;
    onChange({ ...prefs, widgets: next });
    setAnnouncement(`${defs.get(key)?.label} moved to position ${to + 1} of ${shown.length}.`);
    // Keep keyboard focus on the moved row; at the ends the pressed button
    // disables itself, so fall back to its partner.
    if (focusDirection) focusLater([`move-${focusDirection}-${key}`, `move-${focusDirection === "up" ? "down" : "up"}-${key}`]);
  }

  function setVisible(key: WidgetKey, visible: boolean) {
    onChange({ ...prefs, widgets: setWidgetShown(prefs.widgets, key, visible) });
    setAnnouncement(`${defs.get(key)?.label} ${visible ? `shown, at position ${shown.length + 1}` : "hidden"}.`);
    // The row moves between the Shown and Hidden lists; keep focus on it.
    focusLater([`widget-visible-${key}`]);
  }

  function setOption(key: WidgetKey, patch: { scope?: Scope; timeframe?: Timeframe }) {
    onChange({ ...prefs, options: { ...prefs.options, [key]: { ...prefs.options[key], ...patch } } });
  }

  function toggleKpi(key: KpiKey, on: boolean) {
    if (on && prefs.kpis.length >= KPI_LIMIT) return;
    onChange({ ...prefs, kpis: on ? [...prefs.kpis, key] : prefs.kpis.filter((k) => k !== key) });
  }

  function toggleAttention(key: OptionalAttentionCategory, shown: boolean) {
    const hidden = new Set(prefs.hiddenAttention);
    if (shown) hidden.delete(key);
    else hidden.add(key);
    onChange({ ...prefs, hiddenAttention: attention.optional.map((c) => c.key).filter((k) => hidden.has(k)) });
  }

  async function restore() {
    setRestoring(true);
    try {
      await onRestore();
      setConfirmRestore(false);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Customize Dashboard" titleId="customize-dashboard-title">
      <div className="space-y-6 px-5 py-4">
        <StatusLine status={status} onRetry={onRetry} onUndo={onUndo} />
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        <section aria-labelledby="customize-widgets">
          <h3 id="customize-widgets" className={heading}>
            Widgets
          </h3>
          <p className={hint}>Untick to hide a section. Drag a row, or use the arrows, to set the order. Phones use the same order.</p>
          <h4 className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Shown, in order</h4>
          <ol className="mt-1.5 space-y-1.5" aria-label="Shown widgets, in order">
            {shown.map((row, index) => {
              const def = defs.get(row.key)!;
              const opts = effectiveOptions(prefs, row.key);
              const checkboxId = `widget-visible-${row.key}`;
              return (
                <li
                  key={row.key}
                  draggable
                  onDragStart={(e) => {
                    setDragKey(row.key);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", row.key);
                  }}
                  onDragOver={(e) => {
                    if (!dragKey) return;
                    e.preventDefault();
                    setOverKey(row.key);
                  }}
                  onDragLeave={() => setOverKey((k) => (k === row.key ? null : k))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragKey && dragKey !== row.key) move(dragKey, index);
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  onDragEnd={() => {
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  className={`rounded-md border bg-white px-2 py-1.5 ${overKey === row.key && dragKey !== row.key ? "border-emerald-500 ring-1 ring-emerald-500" : "border-slate-200"} ${dragKey === row.key ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-400" aria-hidden="true" />
                    <input id={checkboxId} type="checkbox" checked onChange={() => setVisible(row.key, false)} className="h-4 w-4 shrink-0 rounded border-slate-300 accent-emerald-600" />
                    <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer py-1">
                      <span className="block text-sm font-medium text-slate-900">{def.label}</span>
                      <span className="block text-xs text-slate-500">{def.description}</span>
                    </label>
                    <button id={`move-up-${row.key}`} type="button" className={iconButton} disabled={index === 0} onClick={() => move(row.key, index - 1, "up")} aria-label={`Move ${def.label} up`}>
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button id={`move-down-${row.key}`} type="button" className={iconButton} disabled={index === shown.length - 1} onClick={() => move(row.key, index + 1, "down")} aria-label={`Move ${def.label} down`}>
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  {(def.scope || def.timeframes) && (
                    <div className="ml-12 mt-1 flex flex-wrap gap-2 pb-1">
                      {def.scope && (
                        <select aria-label={`${def.label}: whose items`} value={opts.scope} onChange={(e) => setOption(row.key, { scope: e.target.value as Scope })} className={selectClass}>
                          <option value="mine">{def.scope.mine}</option>
                          <option value="all">{def.scope.all}</option>
                        </select>
                      )}
                      {def.timeframes && (
                        <select aria-label={`${def.label}: timeframe`} value={opts.timeframe ?? def.timeframes[0]} onChange={(e) => setOption(row.key, { timeframe: e.target.value as Timeframe })} className={selectClass}>
                          {def.timeframes.map((t) => (
                            <option key={t} value={t}>
                              {TIMEFRAME_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
            {shown.length === 0 && <li className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">Nothing shown — tick a widget below.</li>}
          </ol>
          {hidden.length > 0 && (
            <>
              <h4 className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">Hidden — tick to add</h4>
              <ul className="mt-1.5 space-y-1" aria-label="Hidden widgets">
                {hidden.map((row) => {
                  const def = defs.get(row.key)!;
                  const checkboxId = `widget-visible-${row.key}`;
                  return (
                    <li key={row.key} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-50">
                      <span className="w-4 shrink-0" aria-hidden="true" />
                      <input id={checkboxId} type="checkbox" checked={false} onChange={() => setVisible(row.key, true)} className="h-4 w-4 shrink-0 rounded border-slate-300 accent-emerald-600" />
                      <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer py-1">
                        <span className="block text-sm font-medium text-slate-700">{def.label}</span>
                        <span className="block text-xs text-slate-500">{def.description}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        {snapshotAvailable && (
          <section aria-labelledby="customize-kpis">
            <h3 id="customize-kpis" className={heading}>
              Business Snapshot KPIs
            </h3>
            <p id="kpi-limit-hint" className={hint}>
              Choose up to {KPI_LIMIT}. {prefs.kpis.length} selected{prefs.kpis.length >= KPI_LIMIT ? " — remove one to add another." : "."}
            </p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {kpis.map((k) => {
                const checked = prefs.kpis.includes(k.key);
                const disabled = !checked && prefs.kpis.length >= KPI_LIMIT;
                const id = `kpi-${k.key}`;
                return (
                  <li key={k.key}>
                    <label htmlFor={id} className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-sm ${disabled ? "text-slate-400" : "cursor-pointer text-slate-800 hover:bg-slate-50"}`} title={k.definition}>
                      <input id={id} type="checkbox" checked={checked} disabled={disabled} aria-describedby="kpi-limit-hint" onChange={(e) => toggleKpi(k.key, e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-emerald-600" />
                      {k.label}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {attentionAvailable && (
          <section aria-labelledby="customize-attention">
            <h3 id="customize-attention" className={heading}>
              Needs Attention
            </h3>
            <p className={hint}>Required items always show — hiding them could mean a missed inspection, an undelivered report, or unpaid work.</p>
            <h4 className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Required attention</h4>
            <ul className="mt-1 space-y-0.5">
              {attention.required.map((c) => (
                <li key={c.key} className="flex items-center gap-2 px-2 py-1 text-sm text-slate-600">
                  <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  {c.label}
                  <span className="sr-only">(always shown)</span>
                </li>
              ))}
            </ul>
            {attention.optional.length > 0 && (
              <>
                <h4 className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Optional categories</h4>
                <ul className="mt-1 space-y-0.5">
                  {attention.optional.map((c) => {
                    const id = `attention-${c.key}`;
                    return (
                      <li key={c.key}>
                        <label htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-800 hover:bg-slate-50">
                          <input id={id} type="checkbox" checked={!prefs.hiddenAttention.includes(c.key)} onChange={(e) => toggleAttention(c.key, e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-emerald-600" />
                          {c.label}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        )}

        <section aria-labelledby="customize-restore" className="rounded-md border border-slate-200 p-3">
          <h3 id="customize-restore" className={heading}>
            Restore default dashboard
          </h3>
          {isDefault ? (
            <p className={hint}>You&apos;re using the default layout for your role.</p>
          ) : confirmRestore ? (
            <div className="mt-1" role="group" aria-label="Confirm restore">
              <p className="text-sm text-slate-700">Replace your layout, KPIs, and filters with the default for your role?</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={restore} disabled={restoring} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
                  {restoring ? "Restoring…" : "Restore default"}
                </button>
                <button type="button" onClick={() => setConfirmRestore(false)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Keep mine
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className={hint}>Go back to the recommended layout for your role.</p>
              <button type="button" onClick={() => setConfirmRestore(true)} className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restore Default Dashboard
              </button>
            </>
          )}
        </section>

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
            Done
          </button>
        </div>
      </div>
    </Drawer>
  );
}

function StatusLine({ status, onRetry, onUndo }: { status: SaveStatus; onRetry: () => void; onUndo: () => void }) {
  return (
    <div role="status" aria-live="polite" className="min-h-9 text-sm">
      {status.kind === "idle" && <p className="text-slate-500">Changes save automatically.</p>}
      {status.kind === "saving" && <p className="text-slate-500">Saving…</p>}
      {status.kind === "saved" && (
        <p className="flex items-center gap-1.5 text-emerald-700">
          <Check className="h-4 w-4" aria-hidden="true" /> {status.message ?? "All changes saved"}
        </p>
      )}
      {status.kind === "error" && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Not saved: {status.message}
          </p>
          <div className="mt-1.5 flex gap-3">
            <button type="button" onClick={onRetry} className="text-sm font-medium underline">
              Try again
            </button>
            <button type="button" onClick={onUndo} className="text-sm font-medium underline">
              Undo my changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
