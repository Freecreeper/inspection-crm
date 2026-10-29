// Pure (client-safe). One user's boards, stored in User.dashboardPreferences
// as a single versioned document:
//
//   { version: 2,
//     boards: { [board]: { desktop: Tile[], phone: Tile[] | null } },
//     hideClear: boolean }
//
// Each board has a desktop layout and, once the user arranges it on a phone,
// a phone layout of its own (until then the phone uses the desktop order).
// Reading is forgiving — anything unknown, unauthorized or malformed is
// dropped, and an older version-1 Dashboard layout is converted — and always
// returns a valid, permission-safe layout. Saving is strict.

import type { Role } from "@prisma/client";
import { z } from "zod";
import { BOARD_IDS, BOARD_PRESETS, SIZES, WINDOWS, canUseWidget, isBoardId, isWidgetKey, widgetDef, type BoardId, type PresetTile, type Scope, type TileSize, type TileWindow, type WidgetKey } from "./catalog";
import { DEFAULT_STYLE, validStyle, type TileStyle } from "./style";

export const BOARD_PREFERENCES_VERSION = 2;
export const MAX_TILES = 24;
export const MAX_STACK = 4;

export interface Tile {
  id: string;
  widget: WidgetKey;
  size: TileSize;
  style: TileStyle;
  window?: TileWindow;
  scope?: Scope;
  // Smart stack only: the widgets it rotates between.
  stack?: WidgetKey[];
}

export interface BoardLayout {
  desktop: Tile[];
  phone: Tile[] | null;
}

export interface BoardPreferences {
  version: 2;
  boards: Partial<Record<BoardId, BoardLayout>>;
  // Hide tiles with nothing urgent instead of shrinking them to "All clear".
  hideClear: boolean;
}

export type Device = "desktop" | "phone";

const TILE_ID = /^[a-z0-9-]{1,40}$/;
let counter = 0;
export function newTileId(widget: WidgetKey): string {
  counter = (counter + 1) % 1_000_000;
  return `${widget.toLowerCase().slice(0, 20)}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

// The window and scope a tile actually uses.
export function tileWindow(t: Pick<Tile, "widget" | "window">): TileWindow {
  return t.window ?? widgetDef(t.widget).defaultWindow;
}
export function tileScope(t: Pick<Tile, "widget" | "scope">, role: Role | null | undefined): Scope {
  if (!widgetDef(t.widget).scoped) return "all";
  // Inspectors start with their own work; everyone else with everything.
  return t.scope ?? (role === "INSPECTOR" ? "mine" : "all");
}

function presetTiles(tiles: readonly PresetTile[], role: Role | null | undefined, board: string): Tile[] {
  return tiles
    .filter((t) => canUseWidget(role, t.widget))
    .map((t, i) => {
      const stack = t.stack?.filter((k) => canUseWidget(role, k));
      return { id: `${board}-${i}-${t.widget.toLowerCase()}`.slice(0, 40), widget: t.widget, size: t.size, style: DEFAULT_STYLE, ...(stack ? { stack } : {}) };
    })
    .filter((t) => t.widget !== "smartStack" || (t.stack?.length ?? 0) > 0);
}

export function defaultLayout(board: BoardId, role: Role | null | undefined): BoardLayout {
  return { desktop: presetTiles(BOARD_PRESETS[board], role, board), phone: null };
}

export function presetLayout(tiles: readonly PresetTile[], role: Role | null | undefined, board: string): Tile[] {
  return presetTiles(tiles, role, board).map((t, i) => ({ ...t, id: `${board}-p${i}-${Date.now().toString(36)}`.slice(0, 40) }));
}

// The layout for a device: the phone's own, or the desktop order.
export function layoutFor(prefs: BoardPreferences, board: BoardId, role: Role | null | undefined, device: Device): Tile[] {
  const layout = prefs.boards[board] ?? defaultLayout(board, role);
  return device === "phone" ? (layout.phone ?? layout.desktop) : layout.desktop;
}

// Every tile a board shows on either device (what the server loads).
export function boardTiles(prefs: BoardPreferences, board: BoardId, role: Role | null | undefined): Tile[] {
  const layout = prefs.boards[board] ?? defaultLayout(board, role);
  const seen = new Set<string>();
  return [...layout.desktop, ...(layout.phone ?? [])].filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

// ---------------------------------------------------------------------------
// Reading (forgiving)
// ---------------------------------------------------------------------------

function cleanTile(raw: unknown, role: Role | null | undefined, ids: Set<string>): Tile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isWidgetKey(r.widget) || !canUseWidget(role, r.widget)) return null;
  const def = widgetDef(r.widget);
  const id = typeof r.id === "string" && TILE_ID.test(r.id) && !ids.has(r.id) ? r.id : null;
  if (!id) return null;
  ids.add(id);
  const size = (def.sizes as readonly string[]).includes(r.size as string) ? (r.size as TileSize) : def.defaultSize;
  const tile: Tile = { id, widget: r.widget, size, style: validStyle(r.style) };
  if (def.windowed && (WINDOWS as readonly string[]).includes(r.window as string)) tile.window = r.window as TileWindow;
  if (def.scoped && (r.scope === "mine" || r.scope === "all")) tile.scope = r.scope;
  if (r.widget === "smartStack") {
    const stack = Array.isArray(r.stack) ? [...new Set(r.stack.filter((k): k is WidgetKey => isWidgetKey(k) && k !== "smartStack" && canUseWidget(role, k)))].slice(0, MAX_STACK) : [];
    if (stack.length === 0) return null;
    tile.stack = stack;
  }
  return tile;
}

function cleanTiles(raw: unknown, role: Role | null | undefined): Tile[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  return raw.slice(0, MAX_TILES).map((t) => cleanTile(t, role, ids)).filter((t): t is Tile => t !== null);
}

// Version 1 (the single Dashboard) → the Overview board: its urgent widgets
// map onto the new ones, in the user's order; KPI and activity widgets,
// which aren't urgent work, don't carry over.
const V1_TO_V2: Record<string, { widget: WidgetKey; size: TileSize }> = {
  needsAttention: { widget: "needsAttention", size: "L" },
  today: { widget: "todaysInspections", size: "M" },
  upcoming: { widget: "upcomingInspections", size: "W" },
  myTasks: { widget: "tasksDue", size: "M" },
  actionQueue: { widget: "emailsToReview", size: "M" },
  reportsPending: { widget: "reportsToFinish", size: "M" },
  outstandingInvoices: { widget: "unpaidInvoices", size: "M" },
  realtorFollowUps: { widget: "followUpsDue", size: "M" },
  leadActivity: { widget: "newLeads", size: "M" },
};

function fromV1(raw: Record<string, unknown>, role: Role | null | undefined): BoardPreferences {
  const order = Array.isArray(raw.widgets) ? raw.widgets : [];
  const tiles = order
    .map((k) => (typeof k === "string" ? V1_TO_V2[k] : undefined))
    .filter((m): m is { widget: WidgetKey; size: TileSize } => Boolean(m) && canUseWidget(role, m!.widget))
    .map((m, i) => ({ id: `overview-v1-${i}`, widget: m.widget, size: m.size, style: DEFAULT_STYLE }));
  return { version: 2, boards: tiles.length ? { overview: { desktop: tiles, phone: null } } : {}, hideClear: false };
}

export function resolveBoardPreferences(raw: unknown, role: Role | null | undefined): BoardPreferences {
  const empty: BoardPreferences = { version: 2, boards: {}, hideClear: false };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;
  if (r.version === 1) return fromV1(r, role);
  // A future/unknown version is treated as stale rather than guessed at.
  if (r.version !== BOARD_PREFERENCES_VERSION) return empty;
  const boards: Partial<Record<BoardId, BoardLayout>> = {};
  if (r.boards && typeof r.boards === "object") {
    for (const [id, layout] of Object.entries(r.boards as Record<string, unknown>)) {
      if (!isBoardId(id) || !layout || typeof layout !== "object") continue;
      const l = layout as Record<string, unknown>;
      boards[id] = { desktop: cleanTiles(l.desktop, role), phone: Array.isArray(l.phone) ? cleanTiles(l.phone, role) : null };
    }
  }
  return { version: 2, boards, hideClear: r.hideClear === true };
}

// ---------------------------------------------------------------------------
// Saving (strict): one board's layout for one device
// ---------------------------------------------------------------------------

const tileSchema = z
  .object({
    id: z.string().regex(TILE_ID),
    widget: z.string(),
    size: z.enum(SIZES),
    style: z.unknown(),
    window: z.enum(WINDOWS).optional(),
    scope: z.enum(["mine", "all"]).optional(),
    stack: z.array(z.string()).max(MAX_STACK).optional(),
  })
  .strict();
const saveSchema = z.object({ board: z.enum(BOARD_IDS), device: z.enum(["desktop", "phone"]), tiles: z.array(tileSchema).max(MAX_TILES) }).strict();

export type SaveLayoutInput = z.infer<typeof saveSchema>;
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateLayoutSave(input: unknown, role: Role | null | undefined): ValidationResult<{ board: BoardId; device: Device; tiles: Tile[] }> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That layout isn't valid." };
  const { board, device, tiles } = parsed.data;
  const ids = new Set<string>();
  const out: Tile[] = [];
  for (const t of tiles) {
    if (!isWidgetKey(t.widget)) return { ok: false, error: "Unknown widget." };
    if (!canUseWidget(role, t.widget)) return { ok: false, error: "You don't have access to one of those widgets." };
    if (ids.has(t.id)) return { ok: false, error: "Duplicate tile." };
    const def = widgetDef(t.widget);
    if (!def.sizes.includes(t.size)) return { ok: false, error: `${def.label} can't be that size.` };
    if (t.window && !def.windowed) return { ok: false, error: `${def.label} has no time window.` };
    if (t.scope && !def.scoped) return { ok: false, error: `${def.label} can't be narrowed to your items.` };
    if (t.widget === "smartStack" && !(t.stack && t.stack.length > 0)) return { ok: false, error: "A smart stack needs at least one widget." };
    if (t.stack && (t.widget !== "smartStack" || t.stack.some((k) => !isWidgetKey(k) || k === "smartStack" || !canUseWidget(role, k)))) return { ok: false, error: "That stack isn't valid." };
    const style = validStyle(t.style, { strict: true });
    if (!style) return { ok: false, error: "That tile style isn't valid." };
    ids.add(t.id);
    out.push({ id: t.id, widget: t.widget, size: t.size, style, ...(t.window ? { window: t.window } : {}), ...(t.scope ? { scope: t.scope } : {}), ...(t.stack ? { stack: [...new Set(t.stack)] as WidgetKey[] } : {}) });
  }
  return { ok: true, value: { board, device, tiles: out } };
}

export function withLayout(prefs: BoardPreferences, board: BoardId, device: Device, tiles: Tile[], role: Role | null | undefined): BoardPreferences {
  const current = prefs.boards[board] ?? defaultLayout(board, role);
  const next: BoardLayout = device === "phone" ? { desktop: current.desktop, phone: tiles } : { desktop: tiles, phone: current.phone };
  return { ...prefs, boards: { ...prefs.boards, [board]: next } };
}

export function withoutBoard(prefs: BoardPreferences, board: BoardId): BoardPreferences {
  const boards = { ...prefs.boards };
  delete boards[board];
  return { ...prefs, boards };
}
