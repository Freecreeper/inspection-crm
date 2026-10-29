// Server-only. Loads one board: only the tiles placed on it (desktop and
// phone), in parallel, through a shared per-request context. A widget the
// role can't use is never loaded whatever the stored layout says, and one
// widget failing doesn't take the board down.

import type { Role } from "@prisma/client";
import { createDashboardContext } from "@/lib/dashboard/sources";
import { ForbiddenError } from "@/lib/rbac";
import { canUseWidget, widgetDef, type BoardId, type WidgetKey } from "./catalog";
import { clockFor, moreUrgent, topSeverity, type WidgetData } from "./items";
import { createBoardContext, loaderFor, type BoardContext } from "./loaders";
import { boardTiles, tileScope, tileWindow, type BoardPreferences, type Tile } from "./preferences";

export interface BoardViewer {
  userId: string;
  role: Role;
}

async function loadOne(ctx: BoardContext, tile: Pick<Tile, "id" | "widget" | "window" | "scope">): Promise<WidgetData> {
  if (!canUseWidget(ctx.role, tile.widget)) throw new ForbiddenError("dashboard:view");
  if (tile.widget === "smartStack") throw new Error("Stacks load through loadTile.");
  const loaded = await loaderFor(tile.widget)(ctx, { scope: tileScope(tile, ctx.role), window: tileWindow(tile) });
  return { tileId: tile.id, widget: tile.widget, ...loaded, severity: topSeverity(loaded.items) };
}

async function loadTile(ctx: BoardContext, tile: Tile): Promise<WidgetData> {
  try {
    if (tile.widget !== "smartStack") return await loadOne(ctx, tile);
    const children = await Promise.all(
      (tile.stack ?? []).filter((k) => canUseWidget(ctx.role, k)).map((k: WidgetKey, i) => loadOne(ctx, { id: `${tile.id}-${i}`, widget: k }).catch((): WidgetData => errored(`${tile.id}-${i}`, k)))
    );
    // Most urgent first: the stack shows whatever needs attention most.
    const stack = [...children].sort((a, b) => moreUrgent(a.severity, b.severity) || b.total - a.total);
    const top = stack[0];
    return { tileId: tile.id, widget: "smartStack", headline: top?.headline ?? { value: "—", label: "Nothing here" }, items: top?.items ?? [], total: top?.total ?? 0, severity: top?.severity ?? null, stack };
  } catch (err) {
    if (err instanceof ForbiddenError) throw err;
    console.error(`[boards] ${tile.widget} failed`, err);
    return errored(tile.id, tile.widget);
  }
}

function errored(tileId: string, widget: WidgetKey): WidgetData {
  return { tileId, widget, headline: { value: "—", label: widgetDef(widget).label }, items: [], total: 0, severity: null, error: "Couldn't load this." };
}

export async function loadBoard(viewer: BoardViewer, board: BoardId, prefs: BoardPreferences, now = new Date()): Promise<Record<string, WidgetData>> {
  const dashboard = createDashboardContext(viewer, now);
  const ctx = createBoardContext(dashboard, clockFor(now, dashboard.config.timeZone));
  const tiles = boardTiles(prefs, board, viewer.role).filter((t) => canUseWidget(viewer.role, t.widget));
  const loaded = await Promise.all(tiles.map((t) => loadTile(ctx, t)));
  return Object.fromEntries(loaded.map((d) => [d.tileId, d]));
}
