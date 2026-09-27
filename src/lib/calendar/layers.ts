// Pure (client-safe): the Calendar's layers and per-user preferences.

import { isCalendarView, type CalendarView } from "./time";

export const CALENDAR_LAYERS = [
  { key: "inspections", label: "Inspections", defaultOn: true },
  { key: "appointments", label: "Blocked time & appointments", defaultOn: true },
  { key: "tasks", label: "Tasks", defaultOn: true },
  { key: "reports", label: "Report deadlines", defaultOn: true },
  { key: "transactions", label: "Transaction dates", defaultOn: false },
  { key: "realtors", label: "Realtor events", defaultOn: false },
  { key: "billing", label: "Billing", defaultOn: false },
] as const;

export type CalendarLayer = (typeof CALENDAR_LAYERS)[number]["key"];
export const LAYER_KEYS = CALENDAR_LAYERS.map((l) => l.key) as CalendarLayer[];
export const DEFAULT_LAYERS = CALENDAR_LAYERS.filter((l) => l.defaultOn).map((l) => l.key) as CalendarLayer[];

export function parseLayers(value: unknown): CalendarLayer[] {
  if (!Array.isArray(value)) return DEFAULT_LAYERS;
  const allowed = new Set<string>(LAYER_KEYS);
  const picked = value.filter((v): v is CalendarLayer => typeof v === "string" && allowed.has(v));
  // Keep a stable order; an empty list is a valid choice ("show nothing").
  return LAYER_KEYS.filter((k) => picked.includes(k));
}

export interface CalendarPreferences {
  view: CalendarView;
  layers: CalendarLayer[];
  // null = all inspectors.
  inspectorId: string | null;
}

export const DEFAULT_PREFERENCES: CalendarPreferences = { view: "week", layers: DEFAULT_LAYERS, inspectorId: null };

export function normalizePreferences(raw: unknown): CalendarPreferences {
  if (!raw || typeof raw !== "object") return DEFAULT_PREFERENCES;
  const r = raw as Record<string, unknown>;
  const view = isCalendarView(r.view) ? r.view : DEFAULT_PREFERENCES.view;
  const inspectorId = typeof r.inspectorId === "string" && r.inspectorId.length <= 64 ? r.inspectorId : null;
  return { view, layers: "layers" in r ? parseLayers(r.layers) : DEFAULT_LAYERS, inspectorId };
}
