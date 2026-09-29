import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { defaultPreferences, resolvePreferences, visibleWidgets } from "@/lib/dashboard/preferences";
import { restoreDashboardDefaults, saveDashboardPreferences, searchEverything } from "./actions";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;
const as = (role: string | null, id: string | null = "u-a") => vi.mocked(auth).mockResolvedValue((role ? { user: { id, role } } : null) as never);

// A tiny stand-in for the users table, so "saved" means "read back later".
const stored = new Map<string, unknown>();

beforeEach(() => {
  vi.clearAllMocks();
  stored.clear();
  as("OWNER_ADMIN", "u-a");
  db.user.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: { dashboardPreferences: unknown } }) => {
    stored.set(where.id, data.dashboardPreferences === Prisma.DbNull ? null : data.dashboardPreferences);
    return {};
  });
});

// What the page does on the next visit, from any browser or device.
const nextVisit = (userId: string, role: "OWNER_ADMIN" | "INSPECTOR" = "OWNER_ADMIN") => resolvePreferences(JSON.parse(JSON.stringify(stored.get(userId) ?? null)), role);

describe("saving preferences", () => {
  it("a hidden widget stays hidden on the next visit (after logout/login) — it's stored server-side on the user", async () => {
    const p = defaultPreferences("OWNER_ADMIN");
    const result = await saveDashboardPreferences({ ...p, widgets: p.widgets.map((w) => (w.key === "recentActivity" ? { ...w, visible: false } : w)) });
    expect(result.ok).toBe(true);
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u-a" }, data: { dashboardPreferences: expect.objectContaining({ version: 1 }) } });
    expect(visibleWidgets(nextVisit("u-a"))).toEqual(["today", "needsAttention", "actionQueue", "snapshot", "upcoming"]);
  });

  it("widget order and KPI selection persist", async () => {
    const p = defaultPreferences("OWNER_ADMIN");
    const order = ["today", "needsAttention", "upcoming", "recentActivity", "snapshot", "actionQueue"];
    await saveDashboardPreferences({
      ...p,
      widgets: [...order.map((k) => p.widgets.find((w) => w.key === k)!), ...p.widgets.filter((w) => !order.includes(w.key))],
      kpis: ["inspectionsMonth", "revenueMonth", "referralsMonth", "outstandingBalance"],
    });
    expect(visibleWidgets(nextVisit("u-a"))).toEqual(order);
    expect(nextVisit("u-a").kpis).toEqual(["inspectionsMonth", "revenueMonth", "referralsMonth", "outstandingBalance"]);
  });

  it("User A's preferences never touch User B — the user comes from the session, not the request", async () => {
    const p = defaultPreferences("OWNER_ADMIN");
    await saveDashboardPreferences({ ...p, kpis: ["newLeadsMonth"], userId: "u-b" });
    expect(db.user.update).not.toHaveBeenCalled(); // extra fields are rejected outright

    await saveDashboardPreferences({ ...p, kpis: ["newLeadsMonth"] });
    expect(db.user.update).toHaveBeenCalledTimes(1);
    expect(db.user.update.mock.calls[0][0].where).toEqual({ id: "u-a" });
    expect(nextVisit("u-b")).toEqual(defaultPreferences("OWNER_ADMIN"));
  });

  it("invalid layouts are refused and nothing is written", async () => {
    const p = defaultPreferences("OWNER_ADMIN");
    for (const bad of [
      { ...p, widgets: [...p.widgets, { key: "madeUp", visible: true }] },
      { ...p, kpis: ["inspectionsMonth", "inspectionsWeek", "revenueMonth", "avgInspectionValue", "referralsMonth", "newLeadsMonth", "overdueTasks"] },
      { ...p, options: { today: { scope: "everyone" } } },
    ]) {
      expect((await saveDashboardPreferences(bad)).ok).toBe(false);
    }
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("restore default clears the stored layout so the role default applies", async () => {
    const p = defaultPreferences("OWNER_ADMIN");
    await saveDashboardPreferences({ ...p, kpis: ["newLeadsMonth"] });
    const result = await restoreDashboardDefaults();
    expect(result).toEqual({ ok: true, data: defaultPreferences("OWNER_ADMIN") });
    expect(db.user.update).toHaveBeenLastCalledWith({ where: { id: "u-a" }, data: { dashboardPreferences: Prisma.DbNull } });
    expect(nextVisit("u-a")).toEqual(defaultPreferences("OWNER_ADMIN"));
  });

  it("signed-out requests are refused", async () => {
    as(null);
    await expect(saveDashboardPreferences(defaultPreferences("OWNER_ADMIN"))).rejects.toThrow();
    await expect(restoreDashboardDefaults()).rejects.toThrow();
  });
});

describe("global search", () => {
  beforeEach(() => {
    for (const model of ["customer", "realtor", "brokerage", "property", "transaction", "inspection"]) db[model].findMany.mockResolvedValue([]);
  });

  it("requires a signed-in role with search access", async () => {
    as(null);
    await expect(searchEverything("main")).rejects.toThrow();
    as("SOMETHING_ELSE");
    await expect(searchEverything("main")).rejects.toThrow();
    expect(db.customer.findMany).not.toHaveBeenCalled();
  });

  it("is server-side, limited, and needs at least two characters", async () => {
    expect(await searchEverything("m")).toEqual([]);
    expect(db.customer.findMany).not.toHaveBeenCalled();

    db.inspection.findMany.mockResolvedValue([{ id: "i1", status: "SCHEDULED", scheduledAt: new Date("2026-09-29T13:00:00Z"), property: { addressLine1: "123 Main St", city: "Hickory" } }]);
    db.brokerage.findMany.mockResolvedValue([{ id: "b1", name: "Main Street Realty", city: "Hickory" }]);
    const results = await searchEverything("main");
    expect(results).toEqual([
      { kind: "brokerage", id: "b1", label: "Main Street Realty", sublabel: "Hickory", href: "/brokerages/b1" },
      { kind: "inspection", id: "i1", label: "123 Main St, Hickory", sublabel: "scheduled · Tue, Sep 29, 9:00 AM", href: "/inspections/i1" },
    ]);
    for (const model of ["brokerage", "property", "transaction", "inspection"]) {
      expect(db[model].findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
    }
  });
});
