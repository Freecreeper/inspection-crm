"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, LayoutGrid, Maximize2, Minus, Paintbrush, Pencil, Plus, X } from "lucide-react";
import { BOARD_LABELS, SIZE_LABELS, type BoardId, type TileSize, type WidgetDef } from "@/lib/boards/catalog";
import type { WidgetData } from "@/lib/boards/items";
import { newTileId, type BoardLayout, type Device, type Tile } from "@/lib/boards/preferences";
import { DEFAULT_STYLE, RADIUS, tilePaint } from "@/lib/boards/style";
import { applyLayoutPreset, resetBoardLayout, saveBoardLayout, setHideClearTiles } from "../actions";
import { useItemActions } from "./parts";
import { Gallery, LayoutsPanel, QuickSheet, StyleEditor } from "./panels";
import { ClearBody, TileBody } from "./TileBody";

// Grid spans (4 columns on wide screens, 2 on phones; Wide fills the row).
const SPAN: Record<TileSize, string> = {
  S: "col-span-1 row-span-1",
  M: "col-span-2 row-span-1",
  L: "col-span-2 row-span-2",
  W: "col-span-2 sm:col-span-4 row-span-1",
};
const SAVE_DELAY_MS = 600;
const PHONE_QUERY = "(max-width: 639px)";

function useDevice(): Device {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(PHONE_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => (window.matchMedia(PHONE_QUERY).matches ? "phone" : "desktop"),
    () => "desktop"
  );
}

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Tiles glide to their new places when the order or a size changes (FLIP).
// Call `snapshot` just before the change.
function useGlide(gridRef: React.RefObject<HTMLElement | null>, key: string, skip: string | null) {
  const before = useRef<Map<string, DOMRect> | null>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const prev = before.current;
    before.current = null;
    if (!grid || !prev || reducedMotion()) return;
    for (const el of grid.querySelectorAll<HTMLElement>("[data-tile]")) {
      const id = el.dataset.tile!;
      const was = prev.get(id);
      if (!was || id === skip || typeof el.animate !== "function") continue;
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
  }, [gridRef, key, skip]);
  return useCallback(() => {
    const grid = gridRef.current;
    if (grid) before.current = new Map([...grid.querySelectorAll<HTMLElement>("[data-tile]")].map((el) => [el.dataset.tile!, el.getBoundingClientRect()]));
  }, [gridRef]);
}

export interface BoardViewProps {
  board: BoardId;
  layout: BoardLayout;
  data: Record<string, WidgetData>;
  widgets: WidgetDef[];
  hideClear: boolean;
  timeZone: string;
  now: string;
}

export function BoardView({ board, layout, data, widgets, hideClear: initialHideClear, timeZone, now }: BoardViewProps) {
  const router = useRouter();
  const device = useDevice();
  const defs = useMemo(() => new Map(widgets.map((w) => [w.key, w])), [widgets]);
  const serverTiles = device === "phone" ? (layout.phone ?? layout.desktop) : layout.desktop;
  const serverKey = `${device}:${JSON.stringify(serverTiles)}`;

  const [tiles, setTiles] = useState<Tile[]>(serverTiles);
  const [seenKey, setSeenKey] = useState(serverKey);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [panel, setPanel] = useState<{ kind: "gallery" } | { kind: "layouts" } | { kind: "style"; id: string } | { kind: "sheet"; id: string } | null>(null);
  const [hideClear, setHideClear] = useState(initialHideClear);
  const [notice, setNotice] = useState<string | null>(null);
  const [, startSave] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Take the server's layout when it changes (device switch, refresh after
  // a save or a preset) unless the viewer has unsaved edits.
  if (serverKey !== seenKey && !dirty) {
    setSeenKey(serverKey);
    setTiles(serverTiles);
  }

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const { run, pending } = useItemActions(setNotice);
  const [dragId, setDragId] = useState<string | null>(null);
  const snapshot = useGlide(gridRef, tiles.map((t) => `${t.id}:${t.size}`).join("|"), dragId);

  // Each change shows at once and is saved after a pause; new tiles' data
  // arrives with the refresh that follows.
  function commit(next: Tile[]) {
    snapshot();
    setTiles(next);
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      startSave(async () => {
        const result = await saveBoardLayout({ board, device, tiles: next }).catch(() => ({ ok: false as const, error: "Couldn't save the layout." }));
        if (!result.ok) setNotice(result.error);
        setDirty(false);
        if (next.some((t) => !data[t.id])) router.refresh();
      });
    }, SAVE_DELAY_MS);
  }

  const move = (id: string, to: number) => {
    const from = tiles.findIndex((t) => t.id === id);
    if (from === -1 || to < 0 || to >= tiles.length || to === from) return;
    const next = [...tiles];
    next.splice(to, 0, next.splice(from, 1)[0]);
    commit(next);
  };
  const update = (t: Tile) => commit(tiles.map((x) => (x.id === t.id ? t : x)));
  const remove = (id: string) => commit(tiles.filter((t) => t.id !== id));
  const cycleSize = (t: Tile, dir = 1) => {
    const sizes = defs.get(t.widget)?.sizes ?? ["M"];
    const size = sizes[(sizes.indexOf(t.size) + dir + sizes.length) % sizes.length];
    update({ ...t, size, style: size !== "S" && t.style.shape === "circle" ? { ...t.style, shape: "squircle" } : t.style });
  };
  const add = (w: WidgetDef) => {
    const stack = w.key === "smartStack" ? widgets.filter((x) => x.home === (board === "overview" ? "inspections" : board) && x.key !== "smartStack").slice(0, 3).map((x) => x.key) : undefined;
    commit([...tiles, { id: newTileId(w.key), widget: w.key, size: w.defaultSize, style: DEFAULT_STYLE, ...(stack?.length ? { stack } : {}) }]);
    setPanel(null);
    setEditing(true);
  };

  // ---- dragging (pointer events, so touch works; the browser's own drag
  // and drop doesn't on iPhone) ----
  const drag = useRef<{ id: string; pointerId: number; grabX: number; grabY: number; startX: number; startY: number; moved: boolean; el: HTMLElement; lastSwap: number } | null>(null);
  const place = (x: number, y: number) => {
    const d = drag.current;
    const grid = gridRef.current;
    if (!d || !grid) return;
    const g = grid.getBoundingClientRect();
    d.el.style.transform = `translate(${x - d.grabX - (g.left + d.el.offsetLeft)}px, ${y - d.grabY - (g.top + d.el.offsetTop)}px) scale(1.03)`;
  };
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    // After a swap the dragged tile's grid cell moved; keep it under the finger.
    if (drag.current?.moved && lastPointer.current) place(lastPointer.current.x, lastPointer.current.y);
  });

  function onPointerDown(e: React.PointerEvent<HTMLElement>, id: string) {
    if (!editing || (e.target as HTMLElement).closest("button,a,input,select")) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    drag.current = { id, pointerId: e.pointerId, grabX: e.clientX - r.left, grabY: e.clientY - r.top, startX: e.clientX, startY: e.clientY, moved: false, el, lastSwap: 0 };
    el.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
      d.moved = true;
      d.el.style.zIndex = "30";
      d.el.style.pointerEvents = "none";
      setDragId(d.id);
    }
    lastPointer.current = { x: e.clientX, y: e.clientY };
    place(e.clientX, e.clientY);
    const over = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-tile]");
    const target = over?.dataset.tile;
    if (target && target !== d.id && e.timeStamp - d.lastSwap > 220) {
      d.lastSwap = e.timeStamp;
      move(d.id, tiles.findIndex((t) => t.id === target));
    }
  }
  function onPointerUp(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    lastPointer.current = null;
    if (d.moved) {
      d.el.style.transition = "transform 160ms ease-out";
      d.el.style.transform = "";
      d.el.style.pointerEvents = "";
      setTimeout(() => {
        d.el.style.transition = "";
        d.el.style.zIndex = "";
      }, 170);
      setDragId(null);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>, t: Tile, index: number) {
    if (!editing || e.target !== e.currentTarget) return;
    const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
    if (step && e.shiftKey) {
      e.preventDefault();
      cycleSize(t, step);
    } else if (step) {
      e.preventDefault();
      move(t.id, index + step);
      requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-tile="${t.id}"]`)?.focus());
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(t.id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      setPanel({ kind: "style", id: t.id });
    }
  }

  const visible = tiles.filter((t) => defs.has(t.widget));
  const isClear = (t: Tile) => {
    const d = data[t.id];
    return Boolean(d && !d.error && d.total === 0 && t.widget !== "nextUp" && t.widget !== "timeline");
  };
  const shown = editing ? visible : visible.filter((t) => !(hideClear && isClear(t)));
  const sheetTile = panel?.kind === "sheet" ? tiles.find((t) => t.id === panel.id) : undefined;
  const styleTile = panel?.kind === "style" ? tiles.find((t) => t.id === panel.id) : undefined;
  const btn = "inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-surface px-3 text-sm font-medium text-neutral-700 hover:bg-hover";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {editing ? "Drag tiles to move them. Keyboard: arrows move, Shift+arrows resize, Delete removes, Enter styles." : device === "phone" ? "Phone layout" : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {editing && (
            <>
              <button type="button" onClick={() => setPanel({ kind: "gallery" })} className={btn}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Add widget
              </button>
              <button type="button" onClick={() => setPanel({ kind: "layouts" })} className={btn}>
                <LayoutGrid className="h-4 w-4" aria-hidden="true" /> Layouts
              </button>
            </>
          )}
          <button type="button" onClick={() => setEditing((v) => !v)} aria-pressed={editing} className={editing ? "inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover" : btn}>
            {editing ? (
              <>
                <Check className="h-4 w-4" aria-hidden="true" /> Done
              </>
            ) : (
              <>
                <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
              </>
            )}
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-input bg-surface p-8 text-center">
          <p className="text-sm font-medium text-foreground">{visible.length === 0 ? "This board has no widgets yet." : "All clear — nothing urgent right now."}</p>
          <button type="button" onClick={() => (setEditing(true), setPanel({ kind: "gallery" }))} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            <Plus className="h-4 w-4" aria-hidden="true" /> Add widget
          </button>
        </div>
      ) : (
        <div ref={gridRef} className="relative grid auto-rows-[9.5rem] grid-cols-2 gap-3 [grid-auto-flow:row_dense] sm:grid-cols-4">
          {shown.map((t, index) => {
            const def = defs.get(t.widget)!;
            const clear = !editing && isClear(t);
            const size: TileSize = clear ? "S" : t.size;
            const paint = tilePaint(t.style, clear ? null : data[t.id]?.severity);
            const shape = t.style.shape === "circle" && size !== "S" ? "squircle" : t.style.shape;
            return (
              <div
                key={t.id}
                data-tile={t.id}
                tabIndex={editing ? 0 : -1}
                aria-label={editing ? `${def.label}, ${SIZE_LABELS[t.size]}` : undefined}
                onPointerDown={(e) => onPointerDown(e, t.id)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={(e) => onKeyDown(e, t, index)}
                className={`relative min-w-0 ${SPAN[size]} ${editing ? "cursor-grab touch-none select-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" : ""}`}
              >
                <article
                  className={`flex h-full min-w-0 flex-col overflow-hidden border ${t.style.density === "compact" ? "p-3" : "p-4"} ${editing && dragId !== t.id ? "animate-wiggle motion-reduce:animate-none" : ""} ${dragId === t.id ? "shadow-2xl" : ""}`}
                  style={{ background: paint.background, color: paint.color, borderColor: paint.border, borderRadius: RADIUS[shape], animationDelay: `${(index % 5) * -90}ms` }}
                  onClick={() => {
                    if (!editing && (size === "S" || size === "M") && data[t.id]) setPanel({ kind: "sheet", id: t.id });
                  }}
                >
                  {clear ? <ClearBody def={def} paint={paint} /> : <TileBody def={def} data={data[t.id]} size={size} paint={paint} editing={editing} timeZone={timeZone} now={now} run={run} pending={pending} onOpenSheet={() => data[t.id] && setPanel({ kind: "sheet", id: t.id })} defs={defs} />}
                </article>
                {editing && (
                  <>
                    <button type="button" onClick={() => remove(t.id)} aria-label={`Remove ${def.label}`} className="absolute -left-2 -top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-input bg-surface text-neutral-700 shadow hover:bg-hover">
                      <Minus className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setPanel({ kind: "style", id: t.id })} aria-label={`Style ${def.label}`} className="absolute -right-2 -top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-input bg-surface text-neutral-700 shadow hover:bg-hover">
                      <Paintbrush className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    {def.sizes.length > 1 && (
                      <button type="button" onClick={() => cycleSize(t)} aria-label={`Resize ${def.label} (now ${SIZE_LABELS[t.size]})`} className="absolute -bottom-2 -right-2 z-10 flex h-7 items-center gap-1 rounded-full border border-input bg-surface px-2 text-[11px] font-semibold text-neutral-700 shadow hover:bg-hover">
                        <Maximize2 className="h-3 w-3" aria-hidden="true" /> {t.size}
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {editing && (
            <button type="button" onClick={() => setPanel({ kind: "gallery" })} className="col-span-1 row-span-1 flex flex-col items-center justify-center gap-1 rounded-[22px] border-2 border-dashed border-input text-sm font-medium text-link hover:bg-hover">
              <Plus className="h-5 w-5" aria-hidden="true" /> Add widget
            </button>
          )}
        </div>
      )}

      {sheetTile && data[sheetTile.id] && <QuickSheet def={defs.get(sheetTile.widget)!} data={data[sheetTile.id]} onClose={() => setPanel(null)} run={run} pending={pending} />}
      {panel?.kind === "gallery" && <Gallery board={board} widgets={widgets} onAdd={add} onClose={() => setPanel(null)} />}
      {styleTile && <StyleEditor tile={styleTile} def={defs.get(styleTile.widget)!} defs={defs} widgets={widgets} onChange={update} onRemove={() => (remove(styleTile.id), setPanel(null))} onClose={() => setPanel(null)} />}
      {panel?.kind === "layouts" && (
        <LayoutsPanel
          boardLabel={BOARD_LABELS[board]}
          hideClear={hideClear}
          onHideClear={(v) => {
            setHideClear(v);
            void setHideClearTiles(board, v);
          }}
          onReset={() => {
            setPanel(null);
            void resetBoardLayout(board).then((r) => {
              if (r.ok) {
                snapshot();
                setDirty(false);
                setTiles(r.data);
                router.refresh();
              }
            });
          }}
          onPreset={(id) => {
            setPanel(null);
            void applyLayoutPreset(board, device, id).then((r) => {
              if (r.ok) {
                snapshot();
                setDirty(false);
                setTiles(r.data);
                router.refresh();
              } else setNotice(r.error);
            });
          }}
          onClose={() => setPanel(null)}
        />
      )}

      {notice && (
        <p role="status" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-lg">
          {notice}
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="rounded p-0.5 hover:bg-hover">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </p>
      )}
    </div>
  );
}
