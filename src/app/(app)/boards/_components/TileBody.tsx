"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { formatTime, timeOfDay, toDayKey } from "@/lib/calendar/time";
import type { TileSize, WidgetDef } from "@/lib/boards/catalog";
import type { BoardItem, ItemAction, WidgetData } from "@/lib/boards/items";
import type { TilePaint } from "@/lib/boards/style";
import { ActionButton, SeverityBadge, SeverityDot, WIDGET_ICONS, useNow } from "./parts";

export interface BodyProps {
  def: WidgetDef;
  data: WidgetData | undefined;
  size: TileSize;
  paint: TilePaint;
  editing: boolean;
  timeZone: string;
  now: string;
  run: (a: ItemAction) => void;
  pending: boolean;
  onOpenSheet: () => void;
  defs: Map<string, WidgetDef>;
}

const ROWS: Record<TileSize, number> = { S: 0, M: 2, L: 5, W: 3 };

function Header({ def, data, paint, onOpenSheet, editing }: Pick<BodyProps, "def" | "data" | "paint" | "onOpenSheet" | "editing">) {
  const Icon = WIDGET_ICONS[def.icon];
  return (
    <div className="flex items-start justify-between gap-2">
      <button
        type="button"
        onClick={onOpenSheet}
        disabled={editing}
        className="-m-1 flex min-w-0 items-center gap-1.5 rounded p-1 text-left text-xs font-semibold uppercase tracking-wide hover:underline disabled:no-underline"
        style={{ color: paint.muted }}
      >
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate">{def.label}</span>
      </button>
      {data?.severity && data.severity !== "info" && <SeverityBadge severity={data.severity} />}
    </div>
  );
}

function ItemRows({ items, size, paint, run, pending }: { items: BoardItem[]; size: TileSize; paint: TilePaint; run: BodyProps["run"]; pending: boolean }) {
  const shown = items.slice(0, ROWS[size]);
  if (shown.length === 0) return null;
  const inline = size === "L" || size === "W";
  return (
    <ul className={size === "W" ? "mt-2 grid min-w-0 gap-2 sm:grid-cols-3" : "mt-2 min-w-0 space-y-1.5"}>
      {shown.map((item) => (
        <li key={item.id} className="flex min-w-0 items-start gap-2">
          <SeverityDot severity={item.severity} />
          <div className="min-w-0 flex-1">
            <Link href={item.href} className="block truncate text-sm font-medium hover:underline">
              {item.title}
            </Link>
            {(item.dueLabel || item.subtitle) && (
              <p className="truncate text-xs" style={{ color: paint.muted }}>
                {[item.dueLabel, item.subtitle].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          {inline && item.actions[0] && item.actions[0].kind !== "open" && <ActionButton action={item.actions[0]} run={run} pending={pending} />}
        </li>
      ))}
    </ul>
  );
}

function Headline({ data, size, paint }: { data: WidgetData; size: TileSize; paint: TilePaint }) {
  return (
    <p className="mt-1 flex min-w-0 items-baseline gap-1.5">
      <span className={`${size === "S" ? "text-3xl" : "text-2xl"} font-semibold tabular-nums leading-none`}>{data.headline.value}</span>
      <span className="truncate text-xs" style={{ color: paint.muted }}>
        {data.headline.label}
      </span>
    </p>
  );
}

function ListBody(p: BodyProps & { data: WidgetData }) {
  const more = p.data.total - Math.min(p.data.items.length, ROWS[p.size]);
  return (
    <>
      <Header {...p} />
      <Headline data={p.data} size={p.size} paint={p.paint} />
      <ItemRows items={p.data.items} size={p.size} paint={p.paint} run={p.run} pending={p.pending} />
      {p.size !== "S" && more > 0 && (
        <button type="button" onClick={p.onOpenSheet} disabled={p.editing} className="mt-auto inline-flex items-center gap-0.5 pt-1 text-xs font-medium hover:underline" style={{ color: p.paint.muted }}>
          {more} more <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </>
  );
}

// "1h 20m" until an instant, or null once it's passed.
function countdown(due: string | null, now: Date): string | null {
  if (!due || due.length === 10) return null;
  const mins = Math.round((new Date(due).getTime() - now.getTime()) / 60_000);
  if (mins <= 0) return null;
  return mins >= 60 ? `in ${Math.floor(mins / 60)}h ${mins % 60}m` : `in ${mins}m`;
}

function NextUpBody(p: BodyProps & { data: WidgetData }) {
  const now = useNow(p.now);
  const first = p.data.items[0];
  return (
    <>
      <Header {...p} />
      {first ? (
        <div className="mt-1 min-w-0">
          <p className="text-3xl font-semibold tabular-nums leading-none">{p.data.headline.value}</p>
          <Link href={first.href} className="mt-1 block truncate text-sm font-medium hover:underline">
            {first.title}
          </Link>
          <p className="truncate text-xs" style={{ color: p.paint.muted }}>
            {[countdown(first.due, now), first.subtitle].filter(Boolean).join(" · ")}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-sm" style={{ color: p.paint.muted }}>
          Nothing else today.
        </p>
      )}
    </>
  );
}

function FocusBody(p: BodyProps & { data: WidgetData }) {
  const [index, setIndex] = useState(0);
  const items = p.data.items;
  const item = items[index % Math.max(items.length, 1)];
  if (!item) return <ListBody {...p} />;
  return (
    <>
      <Header {...p} />
      <p className="mt-1 text-xs" style={{ color: p.paint.muted }}>
        {(index % items.length) + 1} of {p.data.total}
      </p>
      <div className="mt-2 min-w-0 flex-1">
        <SeverityBadge severity={item.severity} />
        <Link href={item.href} className="mt-2 block text-lg font-semibold leading-snug hover:underline">
          {item.title}
        </Link>
        {(item.subtitle || item.dueLabel) && (
          <p className="mt-0.5 line-clamp-2 text-sm" style={{ color: p.paint.muted }}>
            {[item.dueLabel, item.subtitle].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {item.actions.slice(0, 3).map((a, i) => (
          <ActionButton key={i} action={a} primary={i === 0} run={p.run} pending={p.pending} />
        ))}
        {items.length > 1 && (
          <button type="button" onClick={() => setIndex((i) => i + 1)} className="inline-flex min-h-8 items-center rounded-md px-2.5 py-1 text-xs font-medium hover:underline" style={{ color: p.paint.muted }}>
            Skip
          </button>
        )}
      </div>
    </>
  );
}

const DAY_START = 7;
const DAY_END = 20;

function TimelineBody(p: BodyProps & { data: WidgetData }) {
  const now = useNow(p.now);
  const timed = p.data.items.filter((i) => i.due && i.due.length > 10 && i.severity !== "overdue");
  const late = p.data.items.filter((i) => i.severity === "overdue");
  const untimed = p.data.items.filter((i) => i.severity !== "overdue" && (!i.due || i.due.length === 10));
  const hourOf = (d: Date) => {
    const [h, m] = timeOfDay(d, p.timeZone).split(":").map(Number);
    return h + m / 60;
  };
  const pos = (h: number) => `${Math.min(100, Math.max(0, ((h - DAY_START) / (DAY_END - DAY_START)) * 100))}%`;
  const nowHour = toDayKey(now, p.timeZone) === toDayKey(new Date(p.now), p.timeZone) ? hourOf(now) : null;
  return (
    <>
      <Header {...p} />
      {late.length > 0 && (
        <p className="mt-1 truncate rounded-md border border-danger-border bg-danger-soft px-2 py-0.5 text-xs text-danger-strong">
          <span className="font-semibold">Late</span> · {late.map((i) => i.title).join(" · ")}
        </p>
      )}
      <div className="relative mt-3 h-12 min-w-0">
        <div className="absolute inset-x-0 top-0 flex justify-between text-[10px]" style={{ color: p.paint.muted }}>
          {[8, 11, 14, 17, 20].map((h) => (
            <span key={h} style={{ position: "absolute", left: pos(h), transform: "translateX(-50%)" }}>
              {h > 12 ? `${h - 12}p` : `${h}a`}
            </span>
          ))}
        </div>
        <div className="absolute inset-x-0 top-4 h-px" style={{ background: p.paint.border === "transparent" ? p.paint.muted : p.paint.border }} />
        {nowHour !== null && nowHour >= DAY_START && nowHour <= DAY_END && (
          <div className="absolute bottom-0 top-3 w-0.5 bg-danger" style={{ left: pos(nowHour) }} aria-label="Now" role="img" />
        )}
        {timed.map((i) => (
          <Link
            key={i.id}
            href={i.href}
            title={`${i.dueLabel} · ${i.title}`}
            className="absolute top-5 max-w-[30%] -translate-x-1/2 truncate rounded-md border border-info-border bg-info-soft px-1.5 py-0.5 text-[11px] font-medium text-info-strong hover:underline"
            style={{ left: pos(hourOf(new Date(i.due!))) }}
          >
            {formatTime(new Date(i.due!), p.timeZone)} {i.title}
          </Link>
        ))}
      </div>
      {untimed.length > 0 && (
        <p className="mt-1 truncate text-xs" style={{ color: p.paint.muted }}>
          Due today: {untimed.map((i) => i.title).join(" · ")}
        </p>
      )}
      {timed.length === 0 && late.length === 0 && untimed.length === 0 && (
        <p className="mt-1 text-xs" style={{ color: p.paint.muted }}>
          Nothing scheduled today.
        </p>
      )}
    </>
  );
}

function StackBody(p: BodyProps & { data: WidgetData }) {
  const [index, setIndex] = useState(0);
  const stack = p.data.stack ?? [];
  const child = stack[index % Math.max(stack.length, 1)];
  const childDef = child ? p.defs.get(child.widget) : undefined;
  return (
    <>
      {child && childDef ? <ListBody {...p} def={childDef} data={child} /> : <Header {...p} />}
      {stack.length > 1 && (
        <div className="mt-auto flex justify-center gap-1.5 pt-1" role="tablist" aria-label="Widgets in this stack">
          {stack.map((c, i) => (
            <button
              key={c.tileId}
              type="button"
              role="tab"
              aria-selected={i === index % stack.length}
              aria-label={p.defs.get(c.widget)?.label}
              onClick={() => setIndex(i)}
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: p.paint.color, opacity: i === index % stack.length ? 1 : 0.3 }}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function TileBody(p: BodyProps) {
  if (!p.data) {
    return (
      <>
        <Header {...p} />
        <p className="mt-2 text-sm" style={{ color: p.paint.muted }}>
          Loading…
        </p>
      </>
    );
  }
  if (p.data.error) {
    return (
      <>
        <Header {...p} />
        <p className="mt-2 text-sm text-danger-strong">{p.data.error}</p>
      </>
    );
  }
  const data = p.data;
  switch (p.def.key) {
    case "nextUp":
      return <NextUpBody {...p} data={data} />;
    case "focusDeck":
      return <FocusBody {...p} data={data} />;
    case "timeline":
      return <TimelineBody {...p} data={data} />;
    case "smartStack":
      return <StackBody {...p} data={data} />;
    default:
      return <ListBody {...p} data={data} />;
  }
}

// What a tile with nothing urgent shrinks to.
export function ClearBody({ def, paint }: { def: WidgetDef; paint: TilePaint }) {
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="truncate text-xs font-semibold uppercase tracking-wide" style={{ color: paint.muted }}>
        {def.label}
      </p>
      <p className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-success-strong">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> All clear
      </p>
    </div>
  );
}
