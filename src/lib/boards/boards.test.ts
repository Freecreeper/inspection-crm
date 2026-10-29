import { describe, it, expect } from "vitest";
import { BOARD_IDS, BOARD_PRESETS, WIDGETS, availableWidgets, canUseWidget } from "./catalog";
import { clockFor, dueLabel, fromAttention, inWindow, severityFor, sortItems, topSeverity } from "./items";
import { boardTiles, defaultLayout, layoutFor, resolveBoardPreferences, tileScope, tileWindow, validateLayoutSave, withLayout } from "./preferences";
import { DEFAULT_STYLE, TILE_COLORS, boldContrast, tilePaint, validStyle } from "./style";

const TZ = "America/New_York";
// Tue Oct 29 2026, 10:00 in New York.
const clock = clockFor(new Date("2026-10-29T14:00:00Z"), TZ);

describe("catalog", () => {
  it("every widget names permissions, a home board and its own default size", () => {
    for (const w of WIDGETS) {
      expect(w.permissions.length).toBeGreaterThan(0);
      expect(BOARD_IDS).toContain(w.home);
      expect(w.sizes).toContain(w.defaultSize);
    }
  });

  it("customizing can't grant access", () => {
    expect(canUseWidget("INSPECTOR", "unpaidInvoices")).toBe(true); // inspectors may read financials
    expect(canUseWidget("INSPECTOR", "tempPasswords")).toBe(false);
    expect(canUseWidget("REPORTING_ANALYST", "emailsToReview")).toBe(true);
    expect(availableWidgets("INSPECTOR").map((w) => w.key)).not.toContain("tempPasswords");
    expect(canUseWidget(null, "tasksDue")).toBe(false);
  });

  it("every board's preset only uses widgets that fit their sizes", () => {
    for (const board of BOARD_IDS) {
      for (const t of BOARD_PRESETS[board]) expect(WIDGETS.find((w) => w.key === t.widget)!.sizes).toContain(t.size);
    }
  });
});

describe("urgency", () => {
  it("reads due dates in the business time zone", () => {
    expect(severityFor("2026-10-28", clock)).toBe("overdue");
    expect(severityFor("2026-10-29", clock)).toBe("today");
    expect(severityFor("2026-10-30", clock)).toBe("soon");
    expect(severityFor("2026-11-04", clock)).toBe("info");
    // 9:00 this morning has passed; 1:30 this afternoon is today.
    expect(severityFor("2026-10-29T13:00:00Z", clock)).toBe("overdue");
    expect(severityFor("2026-10-29T17:30:00Z", clock)).toBe("today");
    // 11pm New York is still today, though it's tomorrow in UTC.
    expect(severityFor("2026-10-30T03:00:00Z", clock)).toBe("today");
    expect(severityFor(null, clock)).toBe("info");
  });

  it("labels days the way people say them", () => {
    expect(dueLabel("2026-10-29", clock)).toBe("Today");
    expect(dueLabel("2026-10-30", clock)).toBe("Tomorrow");
    expect(dueLabel("2026-10-28", clock)).toBe("Overdue · Yesterday");
    expect(dueLabel("2026-10-29T17:30:00Z", clock)).toBe("Today 1:30 PM");
  });

  it("keeps overdue items in every window, and narrows the rest", () => {
    const item = (due: string | null, severity = severityFor(due, clock)) => ({ due, severity });
    expect(inWindow(item("2026-10-20"), "overdue", clock)).toBe(true);
    expect(inWindow(item("2026-10-29"), "overdue", clock)).toBe(false);
    expect(inWindow(item("2026-10-29"), "today", clock)).toBe(true);
    expect(inWindow(item("2026-10-30"), "today", clock)).toBe(false);
    expect(inWindow(item("2026-10-30"), "48h", clock)).toBe(true);
    expect(inWindow(item("2026-11-02"), "48h", clock)).toBe(false);
    expect(inWindow(item("2026-11-02"), "week", clock)).toBe(true);
    expect(inWindow(item(null), "today", clock)).toBe(true);
  });

  it("puts the most urgent first, and reports the top severity", () => {
    const items = [
      { id: "a", due: "2026-10-30", severity: "soon" as const },
      { id: "b", due: "2026-10-27", severity: "overdue" as const },
      { id: "c", due: null, severity: "info" as const },
      { id: "d", due: "2026-10-29", severity: "today" as const },
    ];
    expect(sortItems(items, clock).map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
    expect(topSeverity(items)).toBe("overdue");
    expect(topSeverity([])).toBeNull();
  });

  it("treats critical attention items as overdue whatever their date", () => {
    const base = { id: "x", category: "conflict", required: true, title: "Scheduling conflict", subject: "14 Oak St", detail: null, sourceType: "Inspection", sourceId: "i1", overdue: false, actionLabel: "Review", href: "/inspections/i1", preview: null, occurredAt: null } as const;
    expect(fromAttention({ ...base, severity: "critical", dueAt: "2026-11-03T13:00:00Z" }, clock).severity).toBe("overdue");
    expect(fromAttention({ ...base, severity: "info", dueAt: "2026-10-29" }, clock).severity).toBe("today");
    expect(fromAttention({ ...base, severity: "action", dueAt: "2026-10-25", overdue: true }, clock).severity).toBe("overdue");
  });
});

describe("saved layouts", () => {
  const tile = (o: Record<string, unknown> = {}) => ({ id: "t-1", widget: "tasksDue", size: "M", style: DEFAULT_STYLE, ...o });

  it("starts each board from its preset, without widgets the role can't use", () => {
    const tools = defaultLayout("tools", "INSPECTOR");
    expect(tools.desktop).toEqual([]);
    const inspections = defaultLayout("inspections", "OFFICE_STAFF");
    expect(inspections.desktop.map((t) => t.widget)).toContain("todaysInspections");
    expect(inspections.phone).toBeNull();
  });

  it("validates a save strictly against the catalog and the role", () => {
    expect(validateLayoutSave({ board: "overview", device: "desktop", tiles: [tile()] }, "OFFICE_STAFF").ok).toBe(true);
    expect(validateLayoutSave({ board: "overview", device: "desktop", tiles: [tile({ widget: "tempPasswords", size: "M" })] }, "INSPECTOR")).toMatchObject({ ok: false });
    expect(validateLayoutSave({ board: "overview", device: "desktop", tiles: [tile({ widget: "nextUp", size: "W" })] }, "OFFICE_STAFF")).toMatchObject({ ok: false });
    expect(validateLayoutSave({ board: "nope", device: "desktop", tiles: [] }, "OFFICE_STAFF")).toMatchObject({ ok: false });
    expect(validateLayoutSave({ board: "overview", device: "desktop", tiles: [tile(), tile()] }, "OFFICE_STAFF")).toMatchObject({ ok: false });
    expect(validateLayoutSave({ board: "overview", device: "desktop", tiles: [tile({ style: { ...DEFAULT_STYLE, color: "javascript:x" } })] }, "OFFICE_STAFF")).toMatchObject({ ok: false });
    expect(validateLayoutSave({ board: "overview", device: "desktop", tiles: [tile({ widget: "smartStack", size: "M" })] }, "OFFICE_STAFF")).toMatchObject({ ok: false });
    expect(validateLayoutSave({ board: "overview", device: "desktop", tiles: [tile({ evil: true })] }, "OFFICE_STAFF")).toMatchObject({ ok: false });
  });

  it("reads forgivingly: drops what's unknown or no longer allowed, keeps the rest", () => {
    const prefs = resolveBoardPreferences(
      { version: 2, boards: { overview: { desktop: [tile(), tile({ id: "t-2", widget: "tempPasswords" }), tile({ id: "t-3", widget: "ghost" }), tile({ id: "t-4", size: "XL" })], phone: null }, bogus: {} } },
      "INSPECTOR"
    );
    expect(prefs.boards.overview!.desktop.map((t) => [t.id, t.size])).toEqual([
      ["t-1", "M"],
      ["t-4", "M"],
    ]);
    expect(Object.keys(prefs.boards)).toEqual(["overview"]);
    expect(resolveBoardPreferences({ version: 9 }, "INSPECTOR").boards).toEqual({});
    expect(resolveBoardPreferences("junk", "INSPECTOR").boards).toEqual({});
  });

  it("converts a version-1 Dashboard into the Overview board, in the user's order", () => {
    const prefs = resolveBoardPreferences({ version: 1, widgets: ["myTasks", "snapshot", "needsAttention", "recentActivity", "outstandingInvoices"] }, "OFFICE_STAFF");
    expect(prefs.boards.overview!.desktop.map((t) => t.widget)).toEqual(["tasksDue", "needsAttention", "unpaidInvoices"]);
  });

  it("keeps a phone layout of its own, falling back to the desktop order", () => {
    const base = resolveBoardPreferences(null, "OFFICE_STAFF");
    const desktop = layoutFor(base, "relationships", "OFFICE_STAFF", "desktop");
    expect(layoutFor(base, "relationships", "OFFICE_STAFF", "phone")).toEqual(desktop);
    const phoneOnly = [{ id: "p-1", widget: "tasksDue" as const, size: "S" as const, style: DEFAULT_STYLE }];
    const next = withLayout(base, "relationships", "phone", phoneOnly, "OFFICE_STAFF");
    expect(layoutFor(next, "relationships", "OFFICE_STAFF", "phone")).toEqual(phoneOnly);
    expect(layoutFor(next, "relationships", "OFFICE_STAFF", "desktop")).toEqual(desktop);
    expect(boardTiles(next, "relationships", "OFFICE_STAFF").length).toBe(desktop.length + 1);
  });

  it("starts inspectors on their own work", () => {
    expect(tileScope({ widget: "tasksDue" }, "INSPECTOR")).toBe("mine");
    expect(tileScope({ widget: "tasksDue" }, "OFFICE_STAFF")).toBe("all");
    expect(tileScope({ widget: "newLeads" }, "INSPECTOR")).toBe("all");
    expect(tileWindow({ widget: "dealDeadlines" })).toBe("week");
  });
});

describe("tile styles", () => {
  it("falls back safely, and is strict on save", () => {
    expect(validStyle({ color: "url(x)", fill: "neon" })).toEqual(DEFAULT_STYLE);
    expect(validStyle({ color: "#12AB34", fill: "bold", shape: "circle", density: "compact" })).toEqual({ color: "#12ab34", fill: "bold", shape: "circle", density: "compact" });
    expect(validStyle({ color: "#12ab34" }, { strict: true })).toBeNull();
  });

  it("gives bold fills readable text for any color", () => {
    for (const hex of ["#ffeb3b", "#00ff00", "#0a0a40", "#e91e63", "#808080", "#00bcd4", "#ff8800", "#777777", "#ffffff", "#000000"]) {
      expect(boldContrast(hex)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("paints every named color in every fill", () => {
    for (const color of TILE_COLORS) {
      for (const fill of ["bold", "tint", "outline", "glass"] as const) {
        const paint = tilePaint({ ...DEFAULT_STYLE, color, fill });
        expect(paint.background).toBeTruthy();
        expect(paint.color).toBeTruthy();
      }
    }
  });
});
