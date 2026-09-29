// Pure (client-safe). One user's Dashboard layout as a single versioned
// document on User.dashboardPreferences:
//
//   { version: 1,
//     widgets: [{ key, visible }, …]   // order = display order
//     kpis: [kpiKey, …]                // Business Snapshot, ≤ KPI_LIMIT
//     options: { [widgetKey]: { scope?, timeframe? } }
//     hiddenAttention: [optionalCategory, …] }
//
// Two entry points, deliberately different:
//  - resolvePreferences() READS whatever is stored — stale, malformed, or
//    from an older version — and always returns a valid, permission-safe
//    layout (unknown keys dropped, unauthorized widgets/KPIs removed, new
//    widgets appended hidden). It never throws.
//  - validatePreferences() CHECKS what a browser asks to save, strictly:
//    anything unknown, duplicated, over the limit, or unauthorized is
//    rejected, so an invalid layout is never persisted.

import type { Role } from "@prisma/client";
import { z } from "zod";
import {
  KPI_FALLBACKS,
  KPI_KEYS,
  KPI_LIMIT,
  OPTIONAL_ATTENTION,
  ROLE_DEFAULTS,
  TIMEFRAMES,
  WIDGET_BY_KEY,
  WIDGET_KEYS,
  WIDGETS,
  canUseKpi,
  canUseWidget,
  isKpiKey,
  isOptionalAttention,
  isWidgetKey,
  type KpiKey,
  type OptionalAttentionCategory,
  type Scope,
  type Timeframe,
  type WidgetKey,
} from "./registry";

export const PREFERENCES_VERSION = 1;

export interface WidgetOptions {
  scope?: Scope;
  timeframe?: Timeframe;
}

export interface DashboardPreferences {
  version: 1;
  widgets: { key: WidgetKey; visible: boolean }[];
  kpis: KpiKey[];
  options: Partial<Record<WidgetKey, WidgetOptions>>;
  hiddenAttention: OptionalAttentionCategory[];
}

// Effective per-widget options with defaults applied.
export interface EffectiveOptions {
  scope: Scope;
  timeframe: Timeframe | null;
}

export function effectiveOptions(prefs: DashboardPreferences, key: WidgetKey): EffectiveOptions {
  const def = WIDGET_BY_KEY[key];
  const chosen = prefs.options[key] ?? {};
  return {
    scope: def.scope ? (chosen.scope ?? "all") : "all",
    timeframe: def.timeframes ? (chosen.timeframe && def.timeframes.includes(chosen.timeframe) ? chosen.timeframe : def.timeframes[0]) : null,
  };
}

export function visibleWidgets(prefs: DashboardPreferences): WidgetKey[] {
  return prefs.widgets.filter((w) => w.visible).map((w) => w.key);
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultPreferences(role: Role | null | undefined): DashboardPreferences {
  const base = (role && ROLE_DEFAULTS[role]) || ROLE_DEFAULTS.OWNER_ADMIN;
  const allowed = WIDGETS.filter((w) => canUseWidget(role, w.key)).map((w) => w.key);
  const visible = base.visible.filter((k) => allowed.includes(k));
  const widgets = [...visible.map((key) => ({ key, visible: true })), ...allowed.filter((k) => !visible.includes(k)).map((key) => ({ key, visible: false }))];

  const kpis = base.kpis.filter((k) => canUseKpi(role, k));
  for (const k of KPI_FALLBACKS) {
    if (kpis.length >= base.kpis.length) break;
    if (!kpis.includes(k) && canUseKpi(role, k)) kpis.push(k);
  }

  const options: DashboardPreferences["options"] = {};
  for (const [key, scope] of Object.entries(base.scope) as [WidgetKey, Scope][]) {
    if (allowed.includes(key) && WIDGET_BY_KEY[key].scope) options[key] = { scope };
  }
  return { version: 1, widgets, kpis, options, hiddenAttention: [] };
}

// ---------------------------------------------------------------------------
// Reading (lenient)
// ---------------------------------------------------------------------------

function cleanOptions(key: WidgetKey, raw: unknown): WidgetOptions | null {
  if (!raw || typeof raw !== "object") return null;
  const def = WIDGET_BY_KEY[key];
  const r = raw as Record<string, unknown>;
  const out: WidgetOptions = {};
  if (def.scope && (r.scope === "mine" || r.scope === "all")) out.scope = r.scope;
  if (def.timeframes && typeof r.timeframe === "string" && (def.timeframes as readonly string[]).includes(r.timeframe)) out.timeframe = r.timeframe as Timeframe;
  return Object.keys(out).length ? out : null;
}

export function resolvePreferences(raw: unknown, role: Role | null | undefined): DashboardPreferences {
  const defaults = defaultPreferences(role);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const r = raw as Record<string, unknown>;
  // A future/unknown version is treated as stale rather than guessed at.
  if (r.version !== PREFERENCES_VERSION) return defaults;

  const allowed = new Set(defaults.widgets.map((w) => w.key));

  // Widgets: stored order, known + authorized keys only, first wins.
  let widgets = defaults.widgets;
  if (Array.isArray(r.widgets)) {
    const seen = new Set<WidgetKey>();
    const stored: DashboardPreferences["widgets"] = [];
    for (const entry of r.widgets) {
      if (!entry || typeof entry !== "object") continue;
      const { key, visible } = entry as Record<string, unknown>;
      if (!isWidgetKey(key) || !allowed.has(key) || seen.has(key)) continue;
      seen.add(key);
      stored.push({ key, visible: visible !== false });
    }
    // Widgets added to the catalog (or newly permitted) since this was
    // saved appear at the end, hidden — offered in Customize, not forced.
    for (const w of defaults.widgets) if (!seen.has(w.key)) stored.push({ key: w.key, visible: false });
    widgets = stored;
  }

  let kpis = defaults.kpis;
  if (Array.isArray(r.kpis)) {
    kpis = [...new Set(r.kpis.filter((k): k is KpiKey => isKpiKey(k) && canUseKpi(role, k)))].slice(0, KPI_LIMIT);
  }

  const options: DashboardPreferences["options"] = { ...defaults.options };
  if (r.options && typeof r.options === "object") {
    for (const [key, value] of Object.entries(r.options as Record<string, unknown>)) {
      if (!isWidgetKey(key) || !allowed.has(key)) continue;
      const cleaned = cleanOptions(key, value);
      if (cleaned) options[key] = cleaned;
    }
  }

  const hiddenAttention = Array.isArray(r.hiddenAttention) ? [...new Set(r.hiddenAttention.filter(isOptionalAttention))] : [];

  return { version: 1, widgets, kpis, options, hiddenAttention };
}

// ---------------------------------------------------------------------------
// Saving (strict)
// ---------------------------------------------------------------------------

const optionsSchema = z.strictObject({
  scope: z.enum(["mine", "all"]).optional(),
  timeframe: z.enum(TIMEFRAMES).optional(),
});

const schema = z.strictObject({
  version: z.literal(PREFERENCES_VERSION),
  widgets: z.array(z.strictObject({ key: z.enum(WIDGET_KEYS), visible: z.boolean() })).max(WIDGET_KEYS.length),
  kpis: z.array(z.enum(KPI_KEYS)).max(KPI_LIMIT, `Choose at most ${KPI_LIMIT} KPIs.`),
  options: z.partialRecord(z.enum(WIDGET_KEYS), optionsSchema),
  hiddenAttention: z.array(z.enum(OPTIONAL_ATTENTION.map((c) => c.key) as [OptionalAttentionCategory, ...OptionalAttentionCategory[]])),
});

export type ValidationResult = { ok: true; value: DashboardPreferences } | { ok: false; error: string };

export function validatePreferences(input: unknown, role: Role | null | undefined): ValidationResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message && !issue.message.startsWith("Invalid") ? issue.message : "That Dashboard layout isn't valid." };
  }
  const v = parsed.data;

  const keys = v.widgets.map((w) => w.key);
  if (new Set(keys).size !== keys.length) return { ok: false, error: "Each widget can appear only once." };
  if (new Set(v.kpis).size !== v.kpis.length) return { ok: false, error: "Each KPI can appear only once." };
  if (new Set(v.hiddenAttention).size !== v.hiddenAttention.length) return { ok: false, error: "That Dashboard layout isn't valid." };

  for (const key of keys) {
    if (!canUseWidget(role, key)) return { ok: false, error: `You don't have access to the ${WIDGET_BY_KEY[key].label} widget.` };
  }
  for (const k of v.kpis) {
    if (!canUseKpi(role, k)) return { ok: false, error: "You don't have access to one of those KPIs." };
  }
  for (const [key, opts] of Object.entries(v.options) as [WidgetKey, WidgetOptions][]) {
    const def = WIDGET_BY_KEY[key];
    if (!canUseWidget(role, key)) return { ok: false, error: `You don't have access to the ${def.label} widget.` };
    if (opts.scope && !def.scope) return { ok: false, error: `${def.label} has no filter.` };
    if (opts.timeframe && !def.timeframes?.includes(opts.timeframe)) return { ok: false, error: `That timeframe isn't available for ${def.label}.` };
  }

  // Authorized widgets missing from the list are kept (hidden) so the
  // stored document is always complete.
  const complete = resolvePreferences({ ...v }, role);
  return { ok: true, value: complete };
}

export function samePreferences(a: DashboardPreferences, b: DashboardPreferences): boolean {
  const norm = (p: DashboardPreferences) =>
    JSON.stringify({
      widgets: p.widgets,
      kpis: p.kpis,
      options: p.widgets.map((w) => effectiveOptions(p, w.key)),
      hiddenAttention: [...p.hiddenAttention].sort(),
    });
  return norm(a) === norm(b);
}
