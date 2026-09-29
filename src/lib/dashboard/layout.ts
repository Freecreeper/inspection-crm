// Pure (client-safe). Turns the user's widget order into rows: full-width
// widgets get a row of their own; two consecutive half-width widgets share
// one on wide screens (Upcoming | Recent Activity). A half widget with no
// half neighbour takes the full row rather than leaving a hole. Flattening
// the rows always gives back the user's order — which is exactly the order
// phones stack them in, so desktop and mobile share one configuration.

import { WIDGET_BY_KEY, type WidgetKey } from "./registry";

export function layoutRows(keys: WidgetKey[]): WidgetKey[][] {
  const rows: WidgetKey[][] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const next = keys[i + 1];
    if (WIDGET_BY_KEY[key].span === "half" && next && WIDGET_BY_KEY[next].span === "half") {
      rows.push([key, next]);
      i++;
    } else {
      rows.push([key]);
    }
  }
  return rows;
}

type Entry = { key: WidgetKey; visible: boolean };

// Customize keeps one simple model: the shown widgets in display order,
// then the hidden ones. Showing a widget adds it to the end of what's
// shown; hiding one moves it to the top of the hidden list. Reordering
// only ever happens among shown widgets, so every Move up/down is visible.
export function setWidgetShown(widgets: Entry[], key: WidgetKey, visible: boolean): Entry[] {
  const shown = widgets.filter((w) => w.visible && w.key !== key);
  const hidden = widgets.filter((w) => !w.visible && w.key !== key);
  return [...shown, { key, visible }, ...hidden];
}

export function moveShownWidget(widgets: Entry[], key: WidgetKey, toIndex: number): Entry[] {
  const shown = widgets.filter((w) => w.visible);
  const hidden = widgets.filter((w) => !w.visible);
  const from = shown.findIndex((w) => w.key === key);
  if (from < 0 || toIndex < 0 || toIndex >= shown.length || from === toIndex) return widgets;
  const next = [...shown];
  const [entry] = next.splice(from, 1);
  next.splice(toIndex, 0, entry);
  return [...next, ...hidden];
}

const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Client-safe money formatting (lib/invoices pulls in the Prisma runtime).
export function formatUsd(value: number | string, cents = false): string {
  const n = typeof value === "number" ? value : Number(value);
  return (cents ? usdCents : usdWhole).format(n);
}
