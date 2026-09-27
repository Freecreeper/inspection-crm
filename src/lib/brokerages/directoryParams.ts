// Pure (no Prisma import) so the toolbar, table, and server query share the
// same allow-lists and URL rules — the brokerage counterpart of
// lib/realtors/directoryParams.ts.
export const BROKERAGE_PAGE_SIZE = 25;

export const BROKERAGE_SORTS = ["name", "city"] as const;
export type BrokerageSort = (typeof BROKERAGE_SORTS)[number];

export interface BrokerageDirectoryParams {
  q: string;
  sort: BrokerageSort;
  dir: "asc" | "desc";
  page: number;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseBrokerageParams(raw: RawSearchParams): BrokerageDirectoryParams {
  const sortRaw = first(raw.sort);
  const sort: BrokerageSort = sortRaw && (BROKERAGE_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as BrokerageSort) : "name";
  const dirRaw = first(raw.dir);
  const page = Number.parseInt(first(raw.page) ?? "1", 10);
  return {
    q: (first(raw.q) ?? "").trim().slice(0, 100),
    sort,
    dir: dirRaw === "desc" ? "desc" : "asc",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

// Same rules as directoryHref for realtors: any change but the page itself
// goes back to page 1, and defaults are dropped so URLs stay short.
export function brokerageDirectoryHref(current: URLSearchParams | string, changes: Record<string, string | null>, opts: { resetPage?: boolean } = {}): string {
  const params = new URLSearchParams(typeof current === "string" ? current : current.toString());
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  if ((opts.resetPage ?? true) && !("page" in changes)) params.delete("page");
  if (params.get("page") === "1") params.delete("page");
  if (params.get("dir") === "asc") params.delete("dir");
  if (params.get("sort") === "name") params.delete("sort");
  const qs = params.toString();
  return qs ? `/brokerages?${qs}` : "/brokerages";
}

// Clicking a header sorts by it A–Z; clicking the active one flips it.
export function nextBrokerageSort(current: BrokerageDirectoryParams, clicked: BrokerageSort) {
  if (current.sort !== clicked) return { sort: clicked, dir: "asc" };
  return { sort: clicked, dir: current.dir === "asc" ? "desc" : "asc" };
}

// "123 Main St, Hickory, NC 28601" — skipping whatever parts aren't on file.
export function formatBrokerageAddress(b: { addressLine1: string | null; city: string | null; state: string | null; zip: string | null }): string {
  const stateZip = [b.state, b.zip].filter(Boolean).join(" ");
  return [b.addressLine1, b.city, stateZip].filter(Boolean).join(", ");
}
