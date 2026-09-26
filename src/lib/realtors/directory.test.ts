import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { buildDirectoryQuery, fetchDirectoryPage } from "./directory";
import { parseDirectoryParams, activeFilterCount } from "./directoryParams";

const NOW = new Date("2026-09-26T15:00:00");
const sqlOf = (raw: Record<string, string>) => buildDirectoryQuery(parseDirectoryParams(raw), NOW);
const mockQueryRaw = (prisma as unknown as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw;

beforeEach(() => vi.clearAllMocks());

describe("parseDirectoryParams", () => {
  it("defaults to name ascending, page 1, no filters", () => {
    const p = parseDirectoryParams({});
    expect(p).toMatchObject({ q: "", brokerageId: null, activity: null, sort: "name", dir: "asc", page: 1 });
    expect(activeFilterCount(p)).toBe(0);
  });

  it("ignores anything outside the allow-lists", () => {
    const p = parseDirectoryParams({ sort: 'lastName"; DROP TABLE realtors;--', dir: "sideways", activity: "forever", page: "-4" });
    expect(p).toMatchObject({ sort: "name", dir: "asc", activity: null, page: 1 });
  });

  it("gives derived sorts a sensible default direction", () => {
    expect(parseDirectoryParams({ sort: "lastActivity" }).dir).toBe("desc");
    expect(parseDirectoryParams({ sort: "referrals" }).dir).toBe("desc");
    expect(parseDirectoryParams({ sort: "brokerage" }).dir).toBe("asc");
    expect(parseDirectoryParams({ sort: "nextAction" }).dir).toBe("asc");
  });

  it("reads flag filters and counts active filters", () => {
    const p = parseDirectoryParams({ hasReferrals: "1", missingBrokerage: "1", activity: "30d", brokerageId: "b1" });
    expect(p.flags).toMatchObject({ hasReferrals: true, missingBrokerage: true, needsFollowUp: false });
    expect(activeFilterCount(p)).toBe(4);
  });
});

describe("buildDirectoryQuery", () => {
  it("binds search text as parameters — never interpolated into SQL", () => {
    const sql = sqlOf({ q: "o'brien; drop" });
    expect(sql.sql).not.toContain("o'brien");
    expect(sql.values).toContain("%o'brien;%");
  });

  it("searches first/last/preferred name, email, and brokerage for every term", () => {
    const sql = sqlOf({ q: "sarah keller" });
    for (const col of ['r."firstName"', 'r."lastName"', 'r."preferredName"', 'r."email"', 'b."name"']) expect(sql.sql).toContain(`${col} ILIKE`);
    expect(sql.values).toEqual(expect.arrayContaining(["%sarah%", "%keller%"]));
  });

  it("matches phone numbers by digits, however they were typed", () => {
    const sql = sqlOf({ q: "828-555" });
    expect(sql.sql).toContain('r."phone" LIKE');
    expect(sql.values).toContain("%828555%");
  });

  it("escapes LIKE wildcards in the search text", () => {
    expect(sqlOf({ q: "50%_off" }).values).toContain("%50\\%\\_off%");
  });

  it("filters by brokerage with a bound id", () => {
    const sql = sqlOf({ brokerageId: "brok-1" });
    expect(sql.sql).toContain('r."brokerageId" = ?');
    expect(sql.values).toContain("brok-1");
  });

  it("maps each flag filter to an objective condition", () => {
    expect(sqlOf({ missingBrokerage: "1" }).sql).toContain('r."brokerageId" IS NULL');
    expect(sqlOf({ missingContact: "1" }).sql).toContain('(r."phone" IS NULL OR r."email" IS NULL)');
    expect(sqlOf({ hasReferrals: "1" }).sql).toContain('rf."cnt" > 0');
    expect(sqlOf({ hasTransactions: "1" }).sql).toContain('tx."cnt" > 0');
    expect(sqlOf({ needsFollowUp: "1" }).sql).toMatch(/tk\."completedAt" IS NULL AND tk\."dueAt" < \?/);
  });

  it("always excludes archived realtors", () => {
    expect(sqlOf({}).sql).toContain('r."archivedAt" IS NULL');
  });

  it("counts referrals only through a referral source linked to the realtor", () => {
    const sql = sqlOf({}).sql;
    expect(sql).toMatch(/FROM "transactions" t\s+JOIN "referral_sources" rs ON rs\."id" = t\."referralSourceId"\s+WHERE rs\."realtorId" = r\."id"/);
  });

  it("counts associated transactions once each, even with several roles on one deal", () => {
    expect(sqlOf({}).sql).toContain('COUNT(DISTINCT trr."transactionId")');
  });

  it("sorts by next action with dated follow-ups first, then undated, then none", () => {
    expect(sqlOf({ sort: "nextAction" }).sql).toMatch(/ORDER BY nf\."due" ASC NULLS LAST, \(nf\."open" > 0\) DESC/);
  });

  it("no longer selects or filters on an active status", () => {
    expect(sqlOf({ status: "inactive" } as never).sql).not.toContain('"active"');
  });

  it("orders by the requested column and pages with LIMIT/OFFSET", () => {
    const sql = sqlOf({ sort: "referrals", dir: "asc", page: "3" });
    expect(sql.sql).toMatch(/ORDER BY rf\."cnt" ASC/);
    expect(sql.sql).toContain("LIMIT ? OFFSET ?");
    expect(sql.values.slice(-2)).toEqual([25, 50]);
  });
});

describe("fetchDirectoryPage", () => {
  it("loads a whole page with a single query, however many rows come back (no N+1)", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, totalCount: 60 }));
    mockQueryRaw.mockResolvedValue(rows);

    const result = await fetchDirectoryPage(parseDirectoryParams({}), NOW);

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(60);
    expect(result.rows).toHaveLength(25);
  });

  it("reports zero when nothing matches", async () => {
    mockQueryRaw.mockResolvedValue([]);
    expect((await fetchDirectoryPage(parseDirectoryParams({ q: "zzz" }), NOW)).total).toBe(0);
  });
});
