import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import {
  runReport,
  searchParamsToConfig,
  configToSearchParams,
  type ReportConfig,
} from "./reporting";

const mockPrisma = prisma as unknown as {
  reportFieldCatalogEntry: { findMany: ReturnType<typeof vi.fn> };
  transaction: { findMany: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
};

const TRANSACTION_CATALOG = [
  { entity: "Transaction", fieldKey: "status", label: "Status", dataType: "string", aggregable: false, joinPath: null, active: true },
  { entity: "Transaction", fieldKey: "id", label: "Transaction count", dataType: "string", aggregable: true, joinPath: null, active: true },
  { entity: "Transaction", fieldKey: "city", label: "Property city", dataType: "string", aggregable: false, joinPath: "property", active: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.reportFieldCatalogEntry.findMany.mockResolvedValue(TRANSACTION_CATALOG);
});

describe("runReport — the allow-list (security-critical)", () => {
  it("rejects a column not in the catalog rather than passing it through to Prisma", async () => {
    await expect(
      runReport({
        entity: "Transaction",
        columns: [{ fieldKey: "somethingNotInTheCatalog" }],
        filters: [],
        groupBy: [],
        aggregations: [],
      })
    ).rejects.toThrow(/not in the report catalog/i);
    expect(mockPrisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it("rejects a filter field not in the catalog", async () => {
    await expect(
      runReport({
        entity: "Transaction",
        columns: [],
        filters: [{ fieldKey: "arbitraryField", operator: "equals", value: "x" }],
        groupBy: [],
        aggregations: [],
      })
    ).rejects.toThrow(/not in the report catalog/i);
  });

  it("rejects grouping on a joined (related-entity) field", async () => {
    await expect(
      runReport({
        entity: "Transaction",
        columns: [],
        filters: [],
        groupBy: ["property.city"], // catalog key for the joined field; not an own field
        aggregations: [],
      })
    ).rejects.toThrow(/entity's own fields/i);
  });

  it("rejects aggregating a field the catalog didn't mark aggregable", async () => {
    mockPrisma.transaction.groupBy.mockResolvedValue([]);
    await expect(
      runReport({
        entity: "Transaction",
        columns: [],
        filters: [],
        groupBy: ["status"],
        aggregations: [{ fieldKey: "status", fn: "sum" }], // status isn't aggregable
      })
    ).rejects.toThrow(/not aggregable/i);
  });

  it("rejects an entity outside the fixed REPORTABLE_ENTITIES list", async () => {
    await expect(
      runReport({
        // @ts-expect-error deliberately invalid entity to prove it's rejected at runtime, not just by types
        entity: "User",
        columns: [],
        filters: [],
        groupBy: [],
        aggregations: [],
      })
    ).rejects.toThrow(/unknown entity/i);
  });
});

describe("runReport — grouped mode", () => {
  it("always requests _count._all and reconciles the total from it, not from the aggregations the caller asked for", async () => {
    mockPrisma.transaction.groupBy.mockResolvedValue([
      { status: "LEAD_IN_PROGRESS", _count: { _all: 3 } },
      { status: null, _count: { _all: 2 } }, // the "Unknown" bucket
    ]);

    const result = await runReport({
      entity: "Transaction",
      columns: [],
      filters: [],
      groupBy: ["status"],
      aggregations: [],
    });

    expect(mockPrisma.transaction.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["status"], _count: { _all: true } })
    );
    // Both the named bucket and the NULL/"Unknown" bucket count toward the
    // total — never silently dropped.
    expect(result.reconciledTotal).toBe(5);
  });

  it("passes an orderBy on the first group-by field (Prisma requires this whenever take is used)", async () => {
    mockPrisma.transaction.groupBy.mockResolvedValue([]);
    await runReport({ entity: "Transaction", columns: [], filters: [], groupBy: ["status"], aggregations: [] });

    expect(mockPrisma.transaction.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { status: "asc" } })
    );
  });
});

describe("runReport — row mode", () => {
  it("flattens a joined column into a dotted key instead of leaving it nested", async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([{ status: "LEAD_IN_PROGRESS", property: { city: "Springfield" } }]);
    mockPrisma.transaction.count.mockResolvedValue(1);

    const result = await runReport({
      entity: "Transaction",
      columns: [{ fieldKey: "status" }, { fieldKey: "property.city" }],
      filters: [],
      groupBy: [],
      aggregations: [],
    });

    expect(result.rows).toEqual([{ status: "LEAD_IN_PROGRESS", "property.city": "Springfield" }]);
  });
});

describe("query-string codec round-trip", () => {
  it("round-trips a full config through configToSearchParams -> searchParamsToConfig", () => {
    const original: ReportConfig = {
      entity: "Transaction",
      columns: [{ fieldKey: "status" }, { fieldKey: "property.city" }],
      filters: [{ fieldKey: "status", operator: "equals", value: "LEAD_IN_PROGRESS" }],
      groupBy: ["status"],
      aggregations: [{ fieldKey: "id", fn: "count" }],
      sortField: "createdAt",
      sortDirection: "desc",
      page: 2,
    };

    const params = configToSearchParams(original);
    // Mirror how Next.js hands a Server Component repeated query keys: string[].
    const sp: Record<string, string | string[]> = {};
    for (const key of params.keys()) {
      const values = params.getAll(key);
      sp[key] = values.length > 1 ? values : values[0];
    }

    expect(searchParamsToConfig(sp)).toEqual(original);
  });

  it("returns null for a missing or invalid entity", () => {
    expect(searchParamsToConfig({})).toBeNull();
    expect(searchParamsToConfig({ entity: "NotARealEntity" })).toBeNull();
  });
});
