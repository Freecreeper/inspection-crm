// Pure (no Prisma import) so client components can share the exact same
// allow-lists and parsing the server uses.
export const DIRECTORY_PAGE_SIZE = 25;

export const DIRECTORY_SORTS = ["name", "brokerage", "lastActivity", "transactions", "referrals"] as const;
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];

export const ACTIVITY_RANGES = ["30d", "90d", "stale90"] as const;
export type ActivityRange = (typeof ACTIVITY_RANGES)[number];

export const ACTIVITY_RANGE_LABELS: Record<ActivityRange, string> = {
  "30d": "Active in last 30 days",
  "90d": "Active in last 90 days",
  stale90: "No activity in 90+ days",
};

export const STATUS_FILTERS = ["all", "active", "inactive"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

// Boolean filters, keyed by their URL param. One list so the parser, the
// SQL builder, the filter panel, and the chips can't drift apart.
export const FLAG_FILTERS = {
  hasReferrals: "Has referrals",
  hasTransactions: "Has transactions",
  needsFollowUp: "Needs follow-up",
  missingBrokerage: "Missing brokerage",
  missingContact: "Missing phone or email",
} as const;
export type FlagFilter = keyof typeof FLAG_FILTERS;
export const FLAG_FILTER_KEYS = Object.keys(FLAG_FILTERS) as FlagFilter[];

export interface DirectoryParams {
  q: string;
  status: StatusFilter;
  brokerageId: string | null;
  flags: Record<FlagFilter, boolean>;
  activity: ActivityRange | null;
  sort: DirectorySort;
  dir: "asc" | "desc";
  page: number;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(allowed: readonly T[], raw: string | undefined): T | null {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

export function defaultDirFor(sort: DirectorySort): "asc" | "desc" {
  return sort === "name" || sort === "brokerage" ? "asc" : "desc";
}

// Everything from the URL goes through an allow-list here — nothing a
// caller types is ever interpolated into SQL except as a bound parameter.
export function parseDirectoryParams(raw: RawSearchParams): DirectoryParams {
  const sort = oneOf(DIRECTORY_SORTS, first(raw.sort)) ?? "name";
  const flags = Object.fromEntries(FLAG_FILTER_KEYS.map((key) => [key, first(raw[key]) === "1"])) as Record<FlagFilter, boolean>;
  const page = Number.parseInt(first(raw.page) ?? "1", 10);
  return {
    q: (first(raw.q) ?? "").trim().slice(0, 100),
    status: oneOf(STATUS_FILTERS, first(raw.status)) ?? "all",
    brokerageId: first(raw.brokerageId)?.trim() || null,
    flags,
    activity: oneOf(ACTIVITY_RANGES, first(raw.activity)),
    sort,
    dir: oneOf(["asc", "desc"] as const, first(raw.dir)) ?? defaultDirFor(sort),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function activeFilterCount(params: DirectoryParams): number {
  return (
    (params.status !== "all" ? 1 : 0) +
    (params.brokerageId ? 1 : 0) +
    (params.activity ? 1 : 0) +
    FLAG_FILTER_KEYS.filter((key) => params.flags[key]).length
  );
}
