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

const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Client-safe money formatting (lib/invoices pulls in the Prisma runtime).
export function formatUsd(value: number | string, cents = false): string {
  const n = typeof value === "number" ? value : Number(value);
  return (cents ? usdCents : usdWhole).format(n);
}
