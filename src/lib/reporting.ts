import { prisma } from "@/lib/prisma";

// The Reporting Query Service (§9) — the boundary between the Custom Report
// Builder UI and the database. Every field, filter, and aggregation a caller
// asks for is checked against ReportFieldCatalogEntry (seeded in
// prisma/seed.ts) before it's allowed anywhere near a query. Nothing here
// ever accepts a raw field name, a raw SQL fragment, or an arbitrary Prisma
// relation string from the caller — only entity+fieldKey pairs that already
// exist as active rows in the catalog table.

export const REPORTABLE_ENTITIES = [
  "Lead",
  "Customer",
  "Transaction",
  "Property",
  "Realtor",
  "Brokerage",
  "ReferralSource",
  "Inspection",
  "Finding",
] as const;
export type ReportableEntity = (typeof REPORTABLE_ENTITIES)[number];

// The structural mapping from an entity name to its Prisma delegate and
// relation names is a fact about the schema, not business-configurable data
// — unlike which *fields* are exposed, this part is safe to hardcode.
const DELEGATE_KEY: Record<ReportableEntity, string> = {
  Lead: "lead",
  Customer: "customer",
  Transaction: "transaction",
  Property: "property",
  Realtor: "realtor",
  Brokerage: "brokerage",
  ReferralSource: "referralSource",
  Inspection: "inspection",
  Finding: "finding",
};

type PrismaDelegate = {
  findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
  groupBy: (args: unknown) => Promise<Record<string, unknown>[]>;
  count: (args: unknown) => Promise<number>;
};

// Prisma has no first-class "look up a model delegate by string name" API,
// so a dynamic reporting engine needs one narrow cast somewhere — this is
// that one place. It's safe specifically because `entity` only ever reaches
// here after being checked against REPORTABLE_ENTITIES, a fixed literal
// list, never a caller-supplied string used as-is.
function getDelegate(entity: ReportableEntity): PrismaDelegate {
  const key = DELEGATE_KEY[entity];
  return (prisma as unknown as Record<string, PrismaDelegate>)[key];
}

export const MAX_ROWS = 500;

export type FilterOperator = "equals" | "not" | "contains" | "gt" | "gte" | "lt" | "lte" | "isNull" | "isNotNull";

export interface ReportFilter {
  fieldKey: string; // "city" or "property.city" for a joined field
  operator: FilterOperator;
  value?: string;
}

export interface ReportColumn {
  fieldKey: string;
}

export interface ReportAggregation {
  fieldKey: string;
  fn: "count" | "sum" | "avg";
}

export interface ReportConfig {
  entity: ReportableEntity;
  columns: ReportColumn[];
  filters: ReportFilter[];
  groupBy: string[];
  aggregations: ReportAggregation[];
  sortField?: string;
  sortDirection?: "asc" | "desc";
  page?: number;
}

interface CatalogEntry {
  fieldKey: string;
  dataType: string;
  aggregable: boolean;
  joinPath: string | null;
}

async function loadCatalog(entity: ReportableEntity): Promise<Map<string, CatalogEntry>> {
  const rows = await prisma.reportFieldCatalogEntry.findMany({ where: { entity, active: true } });
  const map = new Map<string, CatalogEntry>();
  for (const row of rows) {
    // The catalog's own fieldKey is the leaf name (e.g. "city"); the public
    // key callers use for a joined field is "<joinPath>.<fieldKey>" so it
    // can't collide with an own-field of the same name.
    const publicKey = row.joinPath ? `${row.joinPath}.${row.fieldKey}` : row.fieldKey;
    map.set(publicKey, { fieldKey: row.fieldKey, dataType: row.dataType, aggregable: row.aggregable, joinPath: row.joinPath });
  }
  return map;
}

class ReportValidationError extends Error {}

function coerceValue(dataType: string, raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  switch (dataType) {
    case "number":
      return Number(raw);
    case "boolean":
      return raw === "true";
    case "date":
      return new Date(raw);
    default:
      return raw;
  }
}

function buildFieldCondition(operator: FilterOperator, dataType: string, raw: string | undefined): Record<string, unknown> {
  switch (operator) {
    case "equals":
      return { equals: coerceValue(dataType, raw) };
    case "not":
      return { not: coerceValue(dataType, raw) };
    case "contains":
      return { contains: raw, mode: "insensitive" };
    case "gt":
      return { gt: coerceValue(dataType, raw) };
    case "gte":
      return { gte: coerceValue(dataType, raw) };
    case "lt":
      return { lt: coerceValue(dataType, raw) };
    case "lte":
      return { lte: coerceValue(dataType, raw) };
    case "isNull":
      return { equals: null };
    case "isNotNull":
      return { not: null };
    default:
      throw new ReportValidationError(`Unsupported operator: ${operator}`);
  }
}

function applyFilter(where: Record<string, unknown>, filter: ReportFilter, entry: CatalogEntry): void {
  const condition = buildFieldCondition(filter.operator, entry.dataType, filter.value);
  if (entry.joinPath) {
    const existing = (where[entry.joinPath] as Record<string, unknown> | undefined) ?? {};
    where[entry.joinPath] = { ...existing, is: { ...(existing.is as object | undefined), [entry.fieldKey]: condition } };
  } else {
    where[filter.fieldKey.split(".").pop() as string] = condition;
  }
}

export interface ReportResult {
  rows: Record<string, unknown>[];
  totalCount: number;
  page: number;
  pageSize: number;
  reconciledTotal: number; // rows + unmatched-filter NULL bucket, so grouped totals never silently drop records
}

// Validates every part of `config` against the live catalog, then runs a
// safe Prisma query — never string-concatenated SQL. Two modes: plain rows
// (paginated `findMany`), or grouped/aggregated (`groupBy`, restricted to
// the entity's own fields — Prisma's groupBy can't aggregate across a
// relation without raw SQL, so joined fields are display/filter-only, never
// a group key here).
export async function runReport(config: ReportConfig): Promise<ReportResult> {
  if (!REPORTABLE_ENTITIES.includes(config.entity)) {
    throw new ReportValidationError(`Unknown entity: ${config.entity}`);
  }
  const catalog = await loadCatalog(config.entity);
  const delegate = getDelegate(config.entity);

  const where: Record<string, unknown> = {};
  for (const filter of config.filters) {
    const entry = catalog.get(filter.fieldKey);
    if (!entry) throw new ReportValidationError(`Field not in the report catalog: ${filter.fieldKey}`);
    applyFilter(where, filter, entry);
  }

  const page = Math.max(1, config.page ?? 1);
  const pageSize = 50;

  if (config.groupBy.length > 0) {
    for (const key of config.groupBy) {
      const entry = catalog.get(key);
      if (!entry) throw new ReportValidationError(`Field not in the report catalog: ${key}`);
      if (entry.joinPath) throw new ReportValidationError("Grouping is only supported on the entity's own fields.");
    }

    const aggArgs: Record<string, Record<string, boolean> | { _all: true }> = { _count: { _all: true } };
    for (const agg of config.aggregations) {
      const entry = catalog.get(agg.fieldKey);
      if (!entry) throw new ReportValidationError(`Field not in the report catalog: ${agg.fieldKey}`);
      if (!entry.aggregable) throw new ReportValidationError(`Field is not aggregable: ${agg.fieldKey}`);
      if (agg.fn === "count") continue; // _count._all above already covers row counts
      const bucket = agg.fn === "sum" ? "_sum" : "_avg";
      aggArgs[bucket] = { ...((aggArgs[bucket] as Record<string, boolean>) ?? {}), [entry.fieldKey]: true };
    }

    const byFields = config.groupBy.map((k) => catalog.get(k)!.fieldKey);
    const rows = await delegate.groupBy({
      by: byFields,
      where,
      ...aggArgs,
      // Prisma requires an explicit orderBy referencing only `by` fields
      // whenever `take` is used on a groupBy query (it won't silently
      // default to the primary key here, since `id` isn't one of the
      // group-by fields) — ordering by the first group key is an arbitrary
      // but stable and always-valid choice.
      orderBy: { [byFields[0]]: "asc" },
      take: MAX_ROWS,
    });

    // Never silently discard NULL group buckets from a total — Prisma's
    // groupBy already produces a bucket for NULL/"Unknown" values, and
    // _count._all (requested unconditionally above) sums every row in
    // every bucket actually returned, not a re-filtered subset of them.
    const reconciledTotal = rows.reduce((sum: number, r: Record<string, unknown>) => {
      const count = (r._count as { _all?: number } | undefined)?._all ?? 0;
      return sum + count;
    }, 0);

    return { rows, totalCount: rows.length, page: 1, pageSize: MAX_ROWS, reconciledTotal };
  }

  const select: Record<string, unknown> = {};
  const include: Record<string, unknown> = {};
  for (const column of config.columns) {
    const entry = catalog.get(column.fieldKey);
    if (!entry) throw new ReportValidationError(`Field not in the report catalog: ${column.fieldKey}`);
    if (entry.joinPath) {
      const existing = (include[entry.joinPath] as { select?: Record<string, boolean> } | undefined) ?? {};
      include[entry.joinPath] = { select: { ...existing.select, [entry.fieldKey]: true } };
    } else {
      select[entry.fieldKey] = true;
    }
  }

  let orderBy: Record<string, unknown> | undefined;
  if (config.sortField) {
    const entry = catalog.get(config.sortField);
    if (!entry) throw new ReportValidationError(`Field not in the report catalog: ${config.sortField}`);
    if (entry.joinPath) throw new ReportValidationError("Sorting is only supported on the entity's own fields.");
    orderBy = { [entry.fieldKey]: config.sortDirection ?? "asc" };
  }

  const [rows, totalCount] = await Promise.all([
    delegate.findMany({
      where,
      select: Object.keys(select).length || Object.keys(include).length ? { ...select, ...include } : undefined,
      orderBy,
      skip: (page - 1) * pageSize,
      take: Math.min(pageSize, MAX_ROWS),
    }),
    delegate.count({ where }),
  ]);

  // Prisma nests every joined field under its relation name (e.g.
  // { status, property: { zip, city } }) — flatten to the same
  // "joinPath.fieldKey" shape the rest of this module already uses for that
  // column (filters, sort, the config codec), so a caller never has to
  // special-case "is this key nested" when rendering or exporting a row.
  const flatRows = rows.map((row) => {
    const flat: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (include[key] && value && typeof value === "object" && !(value instanceof Date)) {
        for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
          flat[`${key}.${nestedKey}`] = nestedValue;
        }
      } else {
        flat[key] = value;
      }
    }
    return flat;
  });

  return { rows: flatRows, totalCount, page, pageSize, reconciledTotal: totalCount };
}

export async function getFieldCatalog(entity: ReportableEntity) {
  return prisma.reportFieldCatalogEntry.findMany({ where: { entity, active: true }, orderBy: { label: "asc" } });
}

const FILTER_SLOTS = 3;
const AGG_SLOTS = 2;

// The Custom Report Builder has no client-side JS anywhere in this app
// (every page here is a plain server-rendered form) — a GET form encodes the
// whole ReportConfig into the URL's query string, and the builder page's own
// server-side render both re-populates the form and (if a config is present)
// runs the report and shows results. Saved reports store this same shape as
// ReportDefinition.config and are reopened by turning it back into a query
// string.
export function configToSearchParams(config: Partial<ReportConfig>): URLSearchParams {
  const params = new URLSearchParams();
  if (config.entity) params.set("entity", config.entity);
  // Repeated keys (columns=a&columns=b), not comma-joined — this is the same
  // shape a plain HTML checkbox group submits and the same shape Next.js
  // parses a repeated query key into (string[]), so the codec matches both
  // the form the builder page renders and the searchParams it receives back.
  config.columns?.forEach((c) => params.append("columns", c.fieldKey));
  config.groupBy?.forEach((g) => params.append("groupBy", g));
  if (config.sortField) params.set("sort", config.sortField);
  if (config.sortDirection) params.set("dir", config.sortDirection);
  if (config.page) params.set("page", String(config.page));
  config.filters?.slice(0, FILTER_SLOTS).forEach((f, i) => {
    params.set(`f${i}_field`, f.fieldKey);
    params.set(`f${i}_op`, f.operator);
    if (f.value !== undefined) params.set(`f${i}_value`, f.value);
  });
  config.aggregations?.slice(0, AGG_SLOTS).forEach((a, i) => {
    params.set(`a${i}_field`, a.fieldKey);
    params.set(`a${i}_fn`, a.fn);
  });
  return params;
}

type SearchParamValue = string | string[] | undefined;

function asArray(value: SearchParamValue): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asString(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Accepts what Next.js hands a Server Component's `searchParams` prop
// directly — a repeated query key (?columns=a&columns=b) arrives as
// string[], a single one as string.
export function searchParamsToConfig(sp: Record<string, SearchParamValue>): ReportConfig | null {
  const entity = asString(sp.entity);
  if (!entity || !REPORTABLE_ENTITIES.includes(entity as ReportableEntity)) return null;

  const columns = asArray(sp.columns).map((fieldKey) => ({ fieldKey }));
  const groupBy = asArray(sp.groupBy);

  const filters: ReportFilter[] = [];
  for (let i = 0; i < FILTER_SLOTS; i++) {
    const fieldKey = asString(sp[`f${i}_field`]);
    const operator = asString(sp[`f${i}_op`]) as FilterOperator | undefined;
    if (!fieldKey || !operator) continue;
    filters.push({ fieldKey, operator, value: asString(sp[`f${i}_value`]) });
  }

  const aggregations: ReportAggregation[] = [];
  for (let i = 0; i < AGG_SLOTS; i++) {
    const fieldKey = asString(sp[`a${i}_field`]);
    const fn = asString(sp[`a${i}_fn`]) as ReportAggregation["fn"] | undefined;
    if (!fieldKey || !fn) continue;
    aggregations.push({ fieldKey, fn });
  }

  return {
    entity: entity as ReportableEntity,
    columns,
    groupBy,
    filters,
    aggregations,
    sortField: asString(sp.sort),
    sortDirection: asString(sp.dir) === "desc" ? "desc" : "asc",
    page: asString(sp.page) ? Number(asString(sp.page)) : 1,
  };
}
