import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { byBrokerage, byRealtor, byReferralSource, percent, resolvePeriod, totalsOf, type TransactionFacts } from "./crossEntity";

const TZ = "America/New_York";
const d = (v: string | number) => new Prisma.Decimal(v);
const tx = (over: Partial<TransactionFacts> & { id: string }): TransactionFacts => ({ startedInPeriod: true, inspections: 1, revenue: d(0), referralSourceId: null, realtors: [], ...over });
const on = (realtorId: string, brokerageId: string | null = null, brokerageName: string | null = null) => ({ realtorId, brokerageId, brokerageName });

describe("resolvePeriod", () => {
  it("covers whole business days, inclusive of the last one", () => {
    const r = resolvePeriod({ period: "this-month" }, "2026-10-30", TZ);
    expect(r).toMatchObject({ key: "this-month", from: "2026-10-01", to: "2026-10-30", label: "Oct 1, 2026 – Oct 30, 2026" });
    expect(r.period!.start.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(r.period!.end.toISOString()).toBe("2026-10-31T04:00:00.000Z");
  });

  it("knows last month, the last 12 months, and all time", () => {
    expect(resolvePeriod({ period: "last-month" }, "2026-03-15", TZ)).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolvePeriod({ period: "last-12-months" }, "2026-10-30", TZ)).toMatchObject({ from: "2025-10-31", to: "2026-10-30" });
    expect(resolvePeriod({ period: "last-12-months" }, "2028-02-29", TZ)).toMatchObject({ from: "2027-03-01", to: "2028-02-29" });
    expect(resolvePeriod({ period: "all" }, "2026-10-30", TZ)).toMatchObject({ period: null, label: "All time" });
  });

  it("takes custom dates in either order, and falls back to this year on anything else", () => {
    expect(resolvePeriod({ period: "custom", from: "2026-06-30", to: "2026-06-01" }, "2026-10-30", TZ)).toMatchObject({ from: "2026-06-01", to: "2026-06-30" });
    expect(resolvePeriod({ period: "custom" }, "2026-10-30", TZ)).toMatchObject({ key: "this-year", from: "2026-01-01" });
    expect(resolvePeriod({ period: "bogus" }, "2026-10-30", TZ)).toMatchObject({ key: "this-year", from: "2026-01-01", to: "2026-10-30" });
  });
});

describe("by referral source", () => {
  it("partitions transactions exactly, adds leads and conversion, and lists 'No referral source' last", () => {
    const facts = [tx({ id: "t1", referralSourceId: "s1", revenue: d(600) }), tx({ id: "t2", referralSourceId: "s1", revenue: d(450), startedInPeriod: false }), tx({ id: "t3", revenue: d(100) })];
    const sources = new Map([["s1", { name: "Google", type: "Online", realtorId: null }], ["s2", { name: "Home show", type: "Event", realtorId: null }]]);
    const rows = byReferralSource(facts, sources, [
      { referralSourceId: "s1", converted: true },
      { referralSourceId: "s1", converted: false },
      { referralSourceId: "s2", converted: false },
    ]);
    expect(rows.map((r) => [r.name, r.leads, r.leadsConverted, r.transactions, r.inspections, r.revenue.toFixed(2)])).toEqual([
      ["Google", 2, 1, 1, 2, "1050.00"],
      ["Home show", 1, 0, 0, 0, "0.00"],
      ["No referral source", 0, 0, 1, 1, "100.00"],
    ]);
    const sum = rows.reduce((acc, r) => acc.plus(r.revenue), d(0));
    expect(sum.equals(totalsOf(facts).revenue)).toBe(true);
  });
});

describe("by Realtor", () => {
  const realtors = new Map([
    ["avery", { name: "Avery Testwell", brokerage: "Test Realty" }],
    ["riley", { name: "Riley Example", brokerage: "Sample Homes" }],
  ]);

  it("credits every Realtor on a deal with all of it, once even with two roles", () => {
    const facts = [tx({ id: "t1", revenue: d(600), realtors: [on("avery"), on("riley"), on("avery")] })];
    const { rows } = byRealtor(facts, realtors, new Map());
    expect(rows.map((r) => [r.name, r.transactions, r.inspections, r.revenue.toFixed(2)])).toEqual([
      ["Avery Testwell", 1, 1, "600.00"],
      ["Riley Example", 1, 1, "600.00"],
    ]);
  });

  it("counts a referral only through the referral source, even when that Realtor wasn't on the deal", () => {
    const facts = [tx({ id: "t1", revenue: d(450), referralSourceId: "src-avery", realtors: [on("riley")] }), tx({ id: "t2", revenue: d(300), realtors: [on("avery")] })];
    const { rows } = byRealtor(facts, realtors, new Map([["src-avery", "avery"]]));
    const avery = rows.find((r) => r.key === "avery")!;
    expect([avery.transactions, avery.revenue.toFixed(2), avery.referrals, avery.referralRevenue.toFixed(2)]).toEqual([1, "300.00", 1, "450.00"]);
    expect(rows.find((r) => r.key === "riley")!.referrals).toBe(0);
  });

  it("keeps deals with no Realtor in their own bucket, and leaves out Realtors with nothing in the period", () => {
    const { rows, withoutRealtor } = byRealtor([tx({ id: "t1", revenue: d(200) })], realtors, new Map());
    expect(rows).toEqual([]);
    expect([withoutRealtor.transactions, withoutRealtor.revenue.toFixed(2)]).toEqual([1, "200.00"]);
  });
});

describe("by brokerage", () => {
  it("credits the brokerage recorded on the deal, once per deal, counting its distinct agents", () => {
    const facts = [
      tx({ id: "t1", revenue: d(600), realtors: [on("a", "b1"), on("b", "b1"), on("c", "b2")] }),
      tx({ id: "t2", revenue: d(100), realtors: [on("a", "b1")] }),
    ];
    const { rows } = byBrokerage(facts, new Map([["b1", "Test Realty"], ["b2", "Sample Homes"]]));
    expect(rows.map((r) => [r.name, r.realtors, r.transactions, r.revenue.toFixed(2)])).toEqual([
      ["Test Realty", 2, 2, "700.00"],
      ["Sample Homes", 1, 1, "600.00"],
    ]);
  });

  it("groups a typed-in brokerage name without a record, and independents last", () => {
    const facts = [tx({ id: "t1", revenue: d(50), realtors: [on("a")] }), tx({ id: "t2", revenue: d(80), realtors: [on("b", null, "Old Office Realty"), on("c", null, "old office realty ")] })];
    const { rows } = byBrokerage(facts, new Map());
    expect(rows.map((r) => [r.name, r.transactions, r.realtors])).toEqual([
      ["Old Office Realty", 1, 2],
      ["No brokerage (independent)", 1, 1],
    ]);
  });
});

it("percent rounds to one decimal and never divides by zero", () => {
  expect(percent(1, 3)).toBe("33.3%");
  expect(percent(1, 2)).toBe("50%");
  expect(percent(0, 0)).toBe("—");
});
