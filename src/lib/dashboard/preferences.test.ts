import { describe, it, expect, vi, beforeEach } from "vitest";

// Lets a test take a permission away from a role, the way a business owner
// narrowing the permission table would.
const denied = new Set<string>();
vi.mock("@/lib/rbac", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rbac")>();
  const can: typeof real.can = (role, permission) => !denied.has(`${role}:${permission}`) && real.can(role, permission);
  return {
    ...real,
    can,
    assertCan: (role: Parameters<typeof can>[0], permission: Parameters<typeof can>[1]) => {
      if (!can(role, permission)) throw new real.ForbiddenError(permission);
    },
  };
});

import { defaultPreferences, effectiveOptions, resolvePreferences, samePreferences, validatePreferences, visibleWidgets, type DashboardPreferences } from "./preferences";
import { KPI_LIMIT, WIDGET_KEYS, availableKpis, availableWidgets } from "./registry";
import { layoutRows, moveShownWidget, setWidgetShown } from "./layout";

beforeEach(() => denied.clear());

const owner = () => defaultPreferences("OWNER_ADMIN");

describe("role defaults", () => {
  it("owner: Today → Needs Attention → Business Snapshot → Upcoming → Recent Activity, with the four headline KPIs", () => {
    const p = owner();
    expect(visibleWidgets(p)).toEqual(["today", "needsAttention", "snapshot", "upcoming", "recentActivity"]);
    expect(p.kpis).toEqual(["inspectionsMonth", "revenueMonth", "avgInspectionValue", "referralsMonth"]);
    // Every other authorized widget is listed (hidden) so Customize can offer it.
    expect(p.widgets.map((w) => w.key).sort()).toEqual([...WIDGET_KEYS].sort());
  });

  it("inspector: their own work first, filtered to them, and no financial KPIs", () => {
    const p = defaultPreferences("INSPECTOR");
    expect(visibleWidgets(p)).toEqual(["today", "needsAttention", "myTasks", "reportsPending", "upcoming"]);
    expect(effectiveOptions(p, "today").scope).toBe("mine");
    expect(effectiveOptions(p, "upcoming").scope).toBe("mine");
    expect(p.kpis.some((k) => ["revenueMonth", "avgInspectionValue", "outstandingBalance", "unpaidInvoices"].includes(k))).toBe(false);
  });

  it("office: operations first, open tasks for everyone, operational KPIs", () => {
    const p = defaultPreferences("OFFICE_STAFF");
    expect(visibleWidgets(p)).toEqual(["today", "needsAttention", "snapshot", "upcoming", "myTasks", "recentActivity"]);
    expect(effectiveOptions(p, "myTasks").scope).toBe("all");
    expect(p.kpis).toEqual(["inspectionsWeek", "unsignedAgreements", "outstandingBalance", "reportsAwaiting"]);
  });

  it("defaults never include what the role can't see — the snapshot is topped up instead", () => {
    denied.add("OWNER_ADMIN:financial:read");
    const p = owner();
    expect(p.widgets.some((w) => w.key === "outstandingInvoices")).toBe(false);
    expect(p.kpis).toEqual(["inspectionsMonth", "referralsMonth", "inspectionsWeek", "reportsAwaiting"]);
  });
});

describe("customizing (validated, then stored)", () => {
  it("a user can hide an authorized widget and show it again", () => {
    const hidden = { ...owner(), widgets: owner().widgets.map((w) => (w.key === "recentActivity" ? { ...w, visible: false } : w)) };
    const saved = validatePreferences(hidden, "OWNER_ADMIN");
    expect(saved.ok).toBe(true);
    // What's stored is what's read back on the next visit (any browser/device).
    const reread = resolvePreferences(JSON.parse(JSON.stringify(saved.ok && saved.value)), "OWNER_ADMIN");
    expect(visibleWidgets(reread)).not.toContain("recentActivity");

    const shown = { ...reread, widgets: reread.widgets.map((w) => (w.key === "recentActivity" ? { ...w, visible: true } : w)) };
    const again = validatePreferences(shown, "OWNER_ADMIN");
    expect(again.ok && visibleWidgets(again.value)).toContain("recentActivity");
  });

  it("a user can reorder widgets and the order survives a round trip", () => {
    const p = owner();
    const order = ["today", "needsAttention", "upcoming", "recentActivity", "snapshot"];
    const reordered: DashboardPreferences = {
      ...p,
      widgets: [...order.map((key) => p.widgets.find((w) => w.key === key)!), ...p.widgets.filter((w) => !order.includes(w.key))],
    };
    const saved = validatePreferences(reordered, "OWNER_ADMIN");
    expect(saved.ok).toBe(true);
    expect(visibleWidgets(resolvePreferences(saved.ok ? saved.value : null, "OWNER_ADMIN"))).toEqual(order);
  });

  it("mobile uses the same logical order: layout rows flatten back to the user's order", () => {
    const order = ["today", "needsAttention", "upcoming", "recentActivity", "snapshot", "myTasks"] as const;
    const rows = layoutRows([...order]);
    expect(rows.flat()).toEqual([...order]);
    // Wide screens pair consecutive half-width widgets; a lone one takes the row.
    expect(rows).toEqual([["today"], ["needsAttention"], ["upcoming", "recentActivity"], ["snapshot"], ["myTasks"]]);
  });

  it("reordering happens among shown widgets only, so every move is visible", () => {
    // A stored layout with hidden widgets interleaved (older data).
    const widgets = [
      { key: "today" as const, visible: true },
      { key: "outstandingInvoices" as const, visible: false },
      { key: "realtorFollowUps" as const, visible: true },
    ];
    expect(moveShownWidget(widgets, "realtorFollowUps", 0).map((w) => w.key)).toEqual(["realtorFollowUps", "today", "outstandingInvoices"]);
    expect(moveShownWidget(widgets, "today", -1)).toBe(widgets);
    // Showing a widget adds it to the end of what's shown; hiding moves it out.
    expect(setWidgetShown(widgets, "outstandingInvoices", true)).toEqual([
      { key: "today", visible: true },
      { key: "realtorFollowUps", visible: true },
      { key: "outstandingInvoices", visible: true },
    ]);
    expect(setWidgetShown(widgets, "today", false).map((w) => `${w.key}:${w.visible}`)).toEqual(["realtorFollowUps:true", "today:false", "outstandingInvoices:false"]);
  });

  it("a user can pick authorized KPIs, and the selection is kept", () => {
    const p = { ...owner(), kpis: ["inspectionsMonth", "revenueMonth", "referralsMonth", "outstandingBalance"] as DashboardPreferences["kpis"] };
    const saved = validatePreferences(p, "OWNER_ADMIN");
    expect(saved.ok && resolvePreferences(saved.value, "OWNER_ADMIN").kpis).toEqual(["inspectionsMonth", "revenueMonth", "referralsMonth", "outstandingBalance"]);
  });

  it(`the KPI limit (${KPI_LIMIT}) is enforced`, () => {
    const seven = availableKpis("OWNER_ADMIN").slice(0, KPI_LIMIT + 1).map((k) => k.key);
    expect(validatePreferences({ ...owner(), kpis: seven }, "OWNER_ADMIN")).toEqual({ ok: false, error: `Choose at most ${KPI_LIMIT} KPIs.` });
    // And a stored over-limit list (older data) is cut down, not trusted.
    expect(resolvePreferences({ ...owner(), kpis: seven }, "OWNER_ADMIN").kpis).toHaveLength(KPI_LIMIT);
  });

  it("an invented widget key is rejected", () => {
    const bad = { ...owner(), widgets: [...owner().widgets, { key: "sqlConsole", visible: true }] };
    expect(validatePreferences(bad, "OWNER_ADMIN").ok).toBe(false);
  });

  it("invalid configuration is rejected: unknown options, bad values, duplicates, extra fields, wrong version", () => {
    const p = owner();
    const cases: unknown[] = [
      { ...p, options: { today: { scope: "everyone" } } },
      { ...p, options: { today: { timeframe: "month" } } }, // Today has no timeframe
      { ...p, options: { snapshot: { scope: "mine" } } }, // Snapshot has no filter
      { ...p, options: { upcoming: { query: "SELECT * FROM users" } } },
      { ...p, widgets: [p.widgets[0], p.widgets[0]] },
      { ...p, kpis: ["inspectionsMonth", "inspectionsMonth"] },
      { ...p, hiddenAttention: ["conflict"] }, // required categories can't be hidden
      { ...p, script: "alert(1)" },
      { ...p, version: 2 },
      "not an object",
      null,
    ];
    for (const c of cases) expect(validatePreferences(c, "OWNER_ADMIN").ok, JSON.stringify(c)).toBe(false);
  });
});

describe("RBAC overrides customization", () => {
  it("a user without financial access can't add a financial widget or KPI", () => {
    denied.add("INSPECTOR:financial:read");
    const p = defaultPreferences("INSPECTOR");
    expect(availableWidgets("INSPECTOR").map((w) => w.key)).not.toContain("outstandingInvoices");
    expect(availableKpis("INSPECTOR").map((k) => k.key)).not.toContain("revenueMonth");

    expect(validatePreferences({ ...p, widgets: [...p.widgets, { key: "outstandingInvoices", visible: true }] }, "INSPECTOR")).toEqual({
      ok: false,
      error: "You don't have access to the Outstanding Invoices widget.",
    });
    expect(validatePreferences({ ...p, kpis: ["revenueMonth"] }, "INSPECTOR")).toEqual({ ok: false, error: "You don't have access to one of those KPIs." });
  });

  it("removing a permission hides previously configured restricted widgets and KPIs", () => {
    const withMoney = { ...owner(), widgets: [...owner().widgets.map((w) => (w.key === "outstandingInvoices" ? { ...w, visible: true } : w))], kpis: ["revenueMonth", "outstandingBalance", "inspectionsMonth"] };
    expect(visibleWidgets(resolvePreferences(withMoney, "OWNER_ADMIN"))).toContain("outstandingInvoices");

    denied.add("OWNER_ADMIN:financial:read");
    const after = resolvePreferences(withMoney, "OWNER_ADMIN");
    expect(after.widgets.map((w) => w.key)).not.toContain("outstandingInvoices");
    expect(after.kpis).toEqual(["inspectionsMonth"]);
  });
});

describe("restore and resilience", () => {
  it("restore default returns the role/permission default", () => {
    const custom = { ...owner(), kpis: ["newLeadsMonth"] as DashboardPreferences["kpis"] };
    expect(samePreferences(resolvePreferences(custom, "OWNER_ADMIN"), owner())).toBe(false);
    // Restoring clears the stored document; reading nothing gives the default.
    expect(resolvePreferences(null, "OWNER_ADMIN")).toEqual(owner());
    expect(resolvePreferences(null, "INSPECTOR")).toEqual(defaultPreferences("INSPECTOR"));
  });

  it("malformed or stale stored preferences never break the Dashboard", () => {
    for (const raw of [null, "garbage", 42, [], { version: 99 }, { version: 1, widgets: "nope", kpis: {}, options: [] }]) {
      expect(resolvePreferences(raw, "OWNER_ADMIN")).toEqual(owner());
    }
    const stale = {
      version: 1,
      widgets: [{ key: "retiredWidget", visible: true }, { key: "upcoming", visible: true }, { key: "upcoming", visible: false }, "junk", { key: "today" }],
      kpis: ["retiredKpi", "inspectionsWeek", 7],
      options: { upcoming: { timeframe: "decade", scope: "mine" }, bogus: { scope: "all" } },
      hiddenAttention: ["conflict", "taskOverdue", "nope"],
    };
    const p = resolvePreferences(stale, "OWNER_ADMIN");
    expect(p.widgets.slice(0, 2)).toEqual([{ key: "upcoming", visible: true }, { key: "today", visible: true }]);
    // Widgets missing from the stored list (e.g. added later) come back hidden.
    expect(p.widgets.find((w) => w.key === "needsAttention")).toEqual({ key: "needsAttention", visible: false });
    expect(p.kpis).toEqual(["inspectionsWeek"]);
    expect(effectiveOptions(p, "upcoming")).toEqual({ scope: "mine", timeframe: "next7" });
    expect(p.hiddenAttention).toEqual(["taskOverdue"]);
  });
});
