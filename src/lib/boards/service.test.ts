import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
const openTasks = vi.fn();
const collectibleInvoices = vi.fn();
vi.mock("@/lib/dashboard/sources", () => ({
  createDashboardContext: (viewer: unknown, now: Date) => ({
    viewer,
    now,
    config: { timeZone: "America/New_York", reportDueDays: 1 },
    today: "2026-10-29",
    startOfToday: new Date("2026-10-29T04:00:00Z"),
    inspectionEvents: async () => [],
    openTasks,
    collectibleInvoices,
  }),
}));
const loadAttention = vi.fn();
vi.mock("@/lib/dashboard/attention", () => ({ loadAttention: (...a: unknown[]) => loadAttention(...a) }));

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { loadBoard } from "./service";
import { DEFAULT_STYLE } from "./style";
import type { BoardPreferences, Tile } from "./preferences";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const NOW = new Date("2026-10-29T14:00:00Z");
const prefs = (tiles: Tile[]): BoardPreferences => ({ version: 2, boards: { overview: { desktop: tiles, phone: null } }, hideClear: false });
const tile = (id: string, widget: Tile["widget"], extra: Partial<Tile> = {}): Tile => ({ id, widget, size: "M", style: DEFAULT_STYLE, ...extra });
const task = (id: string, due: string, extra = {}) => ({ id, title: `Task ${id}`, dueAt: new Date(`${due}T04:00:00Z`), completedAt: null, assigneeId: null, assignee: null, realtor: null, transaction: null, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  openTasks.mockResolvedValue([]);
  collectibleInvoices.mockResolvedValue([]);
  loadAttention.mockResolvedValue([]);
});

describe("loadBoard", () => {
  it("never loads a widget the role can't use, whatever the layout says", async () => {
    db.user.findMany.mockResolvedValue([{ id: "u", name: "Pat", email: "p@x" }]);
    const data = await loadBoard({ userId: "u1", role: "INSPECTOR" }, "overview", prefs([tile("a", "tempPasswords"), tile("b", "tasksDue")]), NOW);
    expect(Object.keys(data)).toEqual(["b"]);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("keeps only the tile's window, overdue first, and gives the right actions", async () => {
    openTasks.mockResolvedValue([task("late", "2026-10-27"), task("today", "2026-10-29"), task("later", "2026-11-04")]);
    const data = await loadBoard({ userId: "u1", role: "OFFICE_STAFF" }, "overview", prefs([tile("t", "tasksDue")]), NOW);
    expect(data.t.items.map((i) => [i.id, i.severity])).toEqual([
      ["task:late", "overdue"],
      ["task:today", "today"],
    ]);
    expect(data.t.severity).toBe("overdue");
    expect(data.t.items[0].actions.map((a) => a.kind)).toEqual(["completeTask", "snoozeTask", "open"]);
  });

  it("offers no task actions to a role that can't update tasks", async () => {
    openTasks.mockResolvedValue([task("late", "2026-10-27")]);
    const data = await loadBoard({ userId: "u1", role: "REPORTING_ANALYST" }, "overview", prefs([tile("t", "tasksDue")]), NOW);
    expect(data.t.items[0].actions.map((a) => a.kind)).toEqual(["open"]);
  });

  it("narrows to my work when the tile says so", async () => {
    await loadBoard({ userId: "u1", role: "OFFICE_STAFF" }, "overview", prefs([tile("t", "tasksDue", { scope: "mine" })]), NOW);
    expect(openTasks).toHaveBeenCalledWith({ assigneeId: "u1" });
  });

  it("isolates a failing widget", async () => {
    openTasks.mockRejectedValue(new Error("db down"));
    db.lead.findMany.mockResolvedValue([]);
    db.lead.count.mockResolvedValue(0);
    const data = await loadBoard({ userId: "u1", role: "OFFICE_STAFF" }, "overview", prefs([tile("t", "tasksDue"), tile("l", "newLeads")]), NOW);
    expect(data.t.error).toBeTruthy();
    expect(data.l.error).toBeUndefined();
  });

  it("shows a smart stack's most urgent widget first", async () => {
    openTasks.mockResolvedValue([task("today", "2026-10-29")]);
    collectibleInvoices.mockResolvedValue([{ id: "i1", invoiceNumber: "1042", status: "OVERDUE", dueAt: new Date("2026-10-10T04:00:00Z"), transactionId: "t1", customer: "Ava Smith", balance: new Prisma.Decimal(250) }]);
    const data = await loadBoard({ userId: "u1", role: "OFFICE_STAFF" }, "overview", prefs([tile("s", "smartStack", { stack: ["tasksDue", "unpaidInvoices"] })]), NOW);
    expect(data.s.stack!.map((c) => c.widget)).toEqual(["unpaidInvoices", "tasksDue"]);
    expect(data.s.severity).toBe("overdue");
    expect(data.s.headline.value).toBe("$250.00");
  });

  it("calls a lead that has waited more than a day late", async () => {
    db.lead.findMany.mockResolvedValue([
      { id: "old", firstName: "Old", lastName: "Lead", email: null, phone: "8285550101", createdAt: new Date("2026-10-27T12:00:00Z") },
      { id: "new", firstName: "New", lastName: "Lead", email: "n@example.com", phone: null, createdAt: new Date("2026-10-29T12:00:00Z") },
    ]);
    db.lead.count.mockResolvedValue(2);
    const data = await loadBoard({ userId: "u1", role: "OFFICE_STAFF" }, "overview", prefs([tile("l", "newLeads")]), NOW);
    expect(data.l.items.map((i) => [i.id, i.severity])).toEqual([
      ["lead:old", "overdue"],
      ["lead:new", "today"],
    ]);
    expect(data.l.items[0].actions[0]).toMatchObject({ kind: "call", phone: "8285550101" });
  });
});
