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
import { restoreDashboardDefaults, saveDashboardPreferences } from "./actions";

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
