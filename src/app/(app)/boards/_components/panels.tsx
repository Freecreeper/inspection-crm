"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { Drawer } from "@/components/Drawer";
import { BOARD_IDS, BOARD_LABELS, LAYOUT_PRESETS, SIZE_LABELS, WINDOWS, WINDOW_LABELS, type BoardId, type TileSize, type WidgetDef, type WidgetKey } from "@/lib/boards/catalog";
import type { BoardItem, ItemAction, WidgetData } from "@/lib/boards/items";
import { MAX_STACK, type Tile } from "@/lib/boards/preferences";
import { FILLS, FILL_LABELS, SHAPES, SHAPE_LABELS, TILE_COLORS, TILE_COLOR_LABELS, tilePaint, type TileStyle } from "@/lib/boards/style";
import { ActionButton, SeverityBadge } from "./parts";

const seg = (on: boolean) => `flex-1 rounded-md px-2 py-1.5 text-sm font-medium ${on ? "bg-surface text-foreground shadow-sm" : "text-neutral-600 hover:text-foreground"}`;

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <div>
      <p id={id} className="text-sm font-medium text-neutral-700">
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={id} className="mt-1 flex flex-wrap rounded-lg bg-neutral-100 p-0.5">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={o.disabled} onClick={() => onChange(o.value)} className={`${seg(value === o.value)} disabled:opacity-40`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick sheet: a widget's items with full-size actions. On touch, swipe a
// row right to complete it or left to snooze it (when the item allows).
// ---------------------------------------------------------------------------

const SWIPE_PX = 80;

function SheetRow({ item, run, pending }: { item: BoardItem; run: (a: ItemAction) => void; pending: boolean }) {
  const complete = item.actions.find((a) => a.kind === "completeTask");
  const snooze = item.actions.find((a) => a.kind === "snoozeTask");
  const start = useRef<{ x: number; id: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const swipeable = Boolean(complete || snooze);
  return (
    <li className="relative overflow-hidden">
      {swipeable && dx !== 0 && (
        <div className={`absolute inset-0 flex items-center px-4 text-sm font-semibold ${dx > 0 ? "justify-start bg-success-soft text-success-strong" : "justify-end bg-info-soft text-info-strong"}`} aria-hidden="true">
          {dx > 0 ? (complete ? "Complete" : "") : snooze ? "Tomorrow" : ""}
        </div>
      )}
      <div
        className="relative bg-surface px-4 py-3"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: swiping ? "none" : "transform 150ms" }}
        onPointerDown={(e) => {
          if (!swipeable || e.pointerType === "mouse") return;
          start.current = { x: e.clientX, id: e.pointerId };
          setSwiping(true);
        }}
        onPointerMove={(e) => {
          if (!start.current || start.current.id !== e.pointerId) return;
          const d = e.clientX - start.current.x;
          setDx((d > 0 && complete) || (d < 0 && snooze) ? d : 0);
        }}
        onPointerUp={() => {
          if (!start.current) return;
          start.current = null;
          setSwiping(false);
          if (dx > SWIPE_PX && complete) run(complete);
          else if (dx < -SWIPE_PX && snooze) run(snooze);
          setDx(0);
        }}
        onPointerCancel={() => {
          start.current = null;
          setSwiping(false);
          setDx(0);
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <Link href={item.href} className="min-w-0 text-sm font-medium text-foreground hover:underline">
            {item.title}
          </Link>
          <SeverityBadge severity={item.severity} />
        </div>
        {(item.dueLabel || item.subtitle) && <p className="mt-0.5 text-xs text-muted-foreground">{[item.dueLabel, item.subtitle].filter(Boolean).join(" · ")}</p>}
        {item.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.actions.map((a, i) => (
              <ActionButton key={i} action={a} primary={i === 0} run={run} pending={pending} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

export function QuickSheet({ def, data, onClose, run, pending }: { def: WidgetDef; data: WidgetData; onClose: () => void; run: (a: ItemAction) => void; pending: boolean }) {
  const titleId = useId();
  const sections = data.stack ? data.stack : [data];
  return (
    <Drawer open onClose={onClose} title={def.label} titleId={titleId}>
      <div className="-mx-4 -mt-2">
        {sections.map((section) => (
          <section key={section.tileId} className="border-b border-border last:border-0">
            {data.stack && <h3 className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.headline.label}</h3>}
            {section.items.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">All clear — nothing urgent here.</p>
            ) : (
              <ul className="divide-y divide-border">
                {section.items.map((item) => (
                  <SheetRow key={item.id} item={item} run={run} pending={pending} />
                ))}
              </ul>
            )}
          </section>
        ))}
        <p className="px-4 py-3 text-sm">
          <Link href={def.href} className="font-medium text-link hover:underline">
            View all {data.total > data.items.length ? `${data.total} ` : ""}→
          </Link>
        </p>
        <p className="px-4 pb-4 text-xs text-muted-foreground">On a phone, swipe a task right to complete it or left to move it to tomorrow.</p>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Gallery: every widget the role can use, this board's first.
// ---------------------------------------------------------------------------

export function Gallery({ board, widgets, onAdd, onClose }: { board: BoardId; widgets: WidgetDef[]; onAdd: (w: WidgetDef) => void; onClose: () => void }) {
  const titleId = useId();
  const groups = [
    { label: "Suggested here", items: widgets.filter((w) => w.home === board || (board === "overview" && ["needsAttention", "focusDeck", "nextUp", "timeline", "smartStack"].includes(w.key))) },
    ...BOARD_IDS.filter((b) => b !== board).map((b) => ({ label: `From ${BOARD_LABELS[b]}`, items: widgets.filter((w) => w.home === b && !(board === "overview" && w.home === "overview")) })),
  ].filter((g) => g.items.length > 0);
  return (
    <Drawer open onClose={onClose} title="Add a widget" titleId={titleId}>
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.label}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h3>
            <ul className="mt-2 space-y-2">
              {g.items.map((w) => (
                <li key={w.key} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{w.label}</p>
                    <p className="text-xs text-muted-foreground">{w.description}</p>
                    <p className="mt-1 text-[11px] text-subtle">Sizes: {w.sizes.map((s) => SIZE_LABELS[s]).join(", ")}</p>
                  </div>
                  <button type="button" onClick={() => onAdd(w)} className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
                    Add
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Style editor: size, shape, color, fill, density, window, scope, stack.
// ---------------------------------------------------------------------------

export function StyleEditor({ tile, def, defs, widgets, onChange, onRemove, onClose }: { tile: Tile; def: WidgetDef; defs: Map<string, WidgetDef>; widgets: WidgetDef[]; onChange: (t: Tile) => void; onRemove: () => void; onClose: () => void }) {
  const titleId = useId();
  const style = tile.style;
  const setStyle = (s: Partial<TileStyle>) => onChange({ ...tile, style: { ...style, ...s } });
  const custom = typeof style.color === "string" && style.color.startsWith("#");
  const paint = tilePaint(style);
  return (
    <Drawer open onClose={onClose} title={`${def.label} tile`} titleId={titleId}>
      <div className="space-y-5">
        <div className="flex h-24 flex-col justify-between border p-3" style={{ background: paint.background, color: paint.color, borderColor: paint.border, borderRadius: style.shape === "sharp" ? 4 : style.shape === "rounded" ? 12 : 22 }}>
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: paint.muted }}>
            {def.label}
          </span>
          <span className="text-2xl font-semibold">3</span>
        </div>

        <Segmented<TileSize> label="Size" value={tile.size} options={(["S", "M", "L", "W"] as TileSize[]).map((s) => ({ value: s, label: SIZE_LABELS[s], disabled: !def.sizes.includes(s) }))} onChange={(size) => onChange({ ...tile, size, style: size !== "S" && style.shape === "circle" ? { ...style, shape: "squircle" } : style })} />
        <Segmented label="Shape" value={style.shape} options={SHAPES.map((s) => ({ value: s, label: SHAPE_LABELS[s], disabled: s === "circle" && tile.size !== "S" }))} onChange={(shape) => setStyle({ shape })} />

        <div>
          <p className="text-sm font-medium text-neutral-700">Color</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {TILE_COLORS.map((c) => {
              const swatch = tilePaint({ ...style, color: c, fill: "bold" });
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={TILE_COLOR_LABELS[c]}
                  aria-pressed={style.color === c}
                  onClick={() => setStyle({ color: c })}
                  className={`h-8 w-8 rounded-full border border-border ${style.color === c ? "outline-2 outline-offset-2 outline-ring" : ""}`}
                  style={{ background: c === "auto" ? "var(--color-surface)" : swatch.background }}
                  title={TILE_COLOR_LABELS[c]}
                />
              );
            })}
            <label className="inline-flex items-center gap-1.5 text-sm text-neutral-700">
              <input type="color" value={custom ? (style.color as string) : "#2563eb"} onChange={(e) => setStyle({ color: e.target.value.toLowerCase() })} className={`h-8 w-10 cursor-pointer rounded border bg-surface p-0.5 ${custom ? "border-ring" : "border-input"}`} />
              Custom
            </label>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Text color is picked for readability, and urgent badges keep their own colors.</p>
        </div>

        <Segmented label="Style" value={style.fill} options={FILLS.map((f) => ({ value: f, label: FILL_LABELS[f] }))} onChange={(fill) => setStyle({ fill })} />
        <Segmented label="Density" value={style.density} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} onChange={(density) => setStyle({ density })} />

        {def.windowed && (
          <label className="block text-sm font-medium text-neutral-700">
            Show
            <select value={tile.window ?? def.defaultWindow} onChange={(e) => onChange({ ...tile, window: e.target.value as Tile["window"] })} className="mt-1 block w-full rounded-md border border-input bg-surface px-2 py-1.5 text-sm">
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {WINDOW_LABELS[w]}
                </option>
              ))}
            </select>
          </label>
        )}
        {def.scoped && <Segmented label="Whose" value={tile.scope ?? "default"} options={[{ value: "default", label: "Default" }, { value: "mine", label: "Mine" }, { value: "all", label: "Everyone" }]} onChange={(v) => onChange({ ...tile, scope: v === "default" ? undefined : (v as Tile["scope"]) })} />}

        {tile.widget === "smartStack" && (
          <fieldset>
            <legend className="text-sm font-medium text-neutral-700">In this stack (up to {MAX_STACK})</legend>
            <div className="mt-1 max-h-56 space-y-1 overflow-y-auto">
              {widgets
                .filter((w) => w.key !== "smartStack")
                .map((w) => {
                  const on = tile.stack?.includes(w.key) ?? false;
                  const full = (tile.stack?.length ?? 0) >= MAX_STACK;
                  return (
                    <label key={w.key} className="flex items-center gap-2 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!on && full}
                        onChange={(e) => {
                          const stack = e.target.checked ? [...(tile.stack ?? []), w.key] : (tile.stack ?? []).filter((k) => k !== w.key);
                          if (stack.length > 0) onChange({ ...tile, stack: stack as WidgetKey[] });
                        }}
                        className="h-4 w-4 accent-accent"
                      />
                      {defs.get(w.key)?.label}
                    </label>
                  );
                })}
            </div>
          </fieldset>
        )}

        <div className="flex justify-between border-t border-border pt-4">
          <button type="button" onClick={onRemove} className="rounded-md px-3 py-1.5 text-sm font-medium text-danger-strong hover:bg-danger-soft">
            Remove tile
          </button>
          <button type="button" onClick={onClose} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Done
          </button>
        </div>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Layouts: this board's own starting layout, or one of the presets.
// ---------------------------------------------------------------------------

export function LayoutsPanel({ boardLabel, onReset, onPreset, hideClear, onHideClear, onClose }: { boardLabel: string; onReset: () => void; onPreset: (id: string) => void; hideClear: boolean; onHideClear: (v: boolean) => void; onClose: () => void }) {
  const titleId = useId();
  const [confirm, setConfirm] = useState<string | null>(null);
  const option = (id: string, label: string, description: string, apply: () => void) => (
    <li key={id} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {confirm === id ? (
        <button type="button" onClick={apply} className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
          Replace layout
        </button>
      ) : (
        <button type="button" onClick={() => setConfirm(id)} className="shrink-0 rounded-md border border-input bg-surface px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-hover">
          Use
        </button>
      )}
    </li>
  );
  return (
    <Drawer open onClose={onClose} title="Layouts" titleId={titleId}>
      <div className="space-y-5">
        <ul className="space-y-2">
          {option("reset", `${boardLabel} default`, "This board's own starting layout, on every device.", onReset)}
          {LAYOUT_PRESETS.map((p) => option(p.id, p.label, p.description, () => onPreset(p.id)))}
        </ul>
        <label className="flex items-start gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={hideClear} onChange={(e) => onHideClear(e.target.checked)} className="mt-0.5 h-4 w-4 accent-accent" />
          <span>
            Hide tiles with nothing urgent
            <span className="block text-xs text-muted-foreground">Otherwise they shrink to a small &ldquo;All clear&rdquo;.</span>
          </span>
        </label>
      </div>
    </Drawer>
  );
}
