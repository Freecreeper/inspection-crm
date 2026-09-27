import { describe, it, expect } from "vitest";
import { buildBrokerageQuery } from "./directory";
import { brokerageDirectoryHref, formatBrokerageAddress, nextBrokerageSort, parseBrokerageParams } from "./directoryParams";

const query = (raw: Record<string, string>) => buildBrokerageQuery(parseBrokerageParams(raw));

describe("brokerage search", () => {
  it("every term must match some field; digits also match the phone; values are bound, not interpolated", () => {
    const q = query({ q: "greenville 828-555" });
    expect(q.sql).toMatch(/\) AND \(/);
    expect(q.values).toEqual(expect.arrayContaining(["%greenville%", "%828-555%", "%828555%"]));
    expect(q.sql).not.toContain("greenville");
  });

  it("escapes LIKE wildcards and skips the phone match for short digit runs", () => {
    const q = query({ q: "50%_off 12" });
    expect(q.values).toEqual(expect.arrayContaining(["%50\\%\\_off%", "%12%"]));
    expect(q.sql).not.toContain(`b."phone" LIKE`);
    expect(q.values.filter((v) => v === "%12%")).toHaveLength(6);
  });

  it("only ever lists active brokerages", () => {
    expect(query({}).sql).toContain(`b."archivedAt" IS NULL`);
  });
});

describe("brokerage sort and URLs", () => {
  it("only accepts known sorts, sorts case-insensitively, and pages with a stable tiebreak", () => {
    expect(parseBrokerageParams({ sort: "evil;drop", dir: "sideways", page: "-2" })).toEqual({ q: "", sort: "name", dir: "asc", page: 1 });
    expect(query({ sort: "city", dir: "desc" }).sql).toContain(`LOWER(b."city") DESC NULLS LAST, LOWER(b."name") ASC, b."id" ASC`);
    expect(query({ dir: "desc", page: "3" }).sql).toContain(`LOWER(b."name") DESC, b."id" ASC`);
    expect(query({ page: "3" }).values.slice(-2)).toEqual([25, 50]);
  });

  it("clicking the active header flips it; defaults are left out of the URL", () => {
    const params = parseBrokerageParams({});
    expect(nextBrokerageSort(params, "name")).toEqual({ sort: "name", dir: "desc" });
    expect(nextBrokerageSort(params, "city")).toEqual({ sort: "city", dir: "asc" });
    expect(brokerageDirectoryHref("q=kw&page=3", { sort: "name", dir: "asc" })).toBe("/brokerages?q=kw");
    expect(brokerageDirectoryHref("q=kw", { page: "2" }, { resetPage: false })).toBe("/brokerages?q=kw&page=2");
  });

  it("formats an address, skipping missing parts", () => {
    expect(formatBrokerageAddress({ addressLine1: "12 Main St", city: "Hickory", state: "NC", zip: "28601" })).toBe("12 Main St, Hickory, NC 28601");
    expect(formatBrokerageAddress({ addressLine1: null, city: "Hickory", state: null, zip: null })).toBe("Hickory");
  });
});
