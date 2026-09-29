import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

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

import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/rbac";
import { defaultPreferences, type DashboardPreferences } from "./preferences";
import { loadDashboard, loadWidget } from "./service";
import { createDashboardContext } from "./sources";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>> & { $queryRaw: Fn };

// 11:00 AM Tuesday Sep 29 in New York.
const NOW = new Date("2026-09-29T15:00:00Z");
const admin = { userId: "u-admin", role: "OWNER_ADMIN" as const };

function inspectionRow(id: string, scheduledAt: string, over: Record<string, unknown> = {}) {
  return {
    id,
    status: "SCHEDULED",
    scheduledAt: new Date(scheduledAt),
    durationMinutes: 180,
    inspectorId: "u-jordan",
    agreementSignedAt: new Date("2026-09-01T12:00:00Z"),
    property: { addressLine1: `${id} Main St`, city: "Hickory" },
    inspector: { name: "Jordan" },
    inspectionServices: [{ service: { name: "General" } }],
    transaction: { customers: [{ primaryContact: true, customer: { firstName: "Ava", lastName: "Chen", phone: "8285550100", email: null } }], realtors: [], invoices: [] },
    ...over,
  };
}

function prefsWith(visible: DashboardPreferences["widgets"][number]["key"][], over: Partial<DashboardPreferences> = {}): DashboardPreferences {
  const base = defaultPreferences("OWNER_ADMIN");
  return { ...base, widgets: base.widgets.map((w) => ({ ...w, visible: visible.includes(w.key) })), ...over };
}

let inspections: ReturnType<typeof inspectionRow>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  denied.clear();
  vi.stubEnv("APP_TIMEZONE", "America/New_York");
  inspections = [];
  // The Calendar's inspection loader and its report-deadline loader both
  // read inspections; only the first gets rows here.
  db.inspection.findMany.mockImplementation(async (args: { where?: { reports?: unknown } }) => (args.where?.reports ? [] : inspections));
  db.inspection.count.mockResolvedValue(0);
  db.task.findMany.mockResolvedValue([]);
  db.realtor.findMany.mockResolvedValue([]);
  db.$queryRaw.mockResolvedValue([]);
});

describe("Today and Upcoming", () => {
  it("Today returns today's inspections — in the business time zone — and tomorrow's go to Upcoming", async () => {
    inspections = [
      inspectionRow("today-9am", "2026-09-29T13:00:00Z"),
      // 10 PM on the 29th in New York is still *today*, though it's the 30th in UTC.
      inspectionRow("today-10pm", "2026-09-30T02:00:00Z"),
      inspectionRow("tomorrow", "2026-09-30T13:00:00Z"),
      inspectionRow("thursday", "2026-10-01T17:00:00Z", { agreementSignedAt: null }),
      inspectionRow("friday", "2026-10-02T13:00:00Z"),
    ];
    const ctx = createDashboardContext(admin, NOW);
    const prefs = prefsWith(["today", "upcoming"]);

    const today = await loadWidget("today", ctx, prefs);
    expect(today.key === "today" && today.events.map((e) => e.sourceId)).toEqual(["today-9am", "today-10pm"]);

    const upcoming = await loadWidget("upcoming", ctx, prefs);
    expect(upcoming).toMatchObject({
      key: "upcoming",
      total: 3,
      timeframe: "next7",
      days: [
        { day: "2026-09-30", inspections: 1, needsAttention: 0 },
        { day: "2026-10-01", inspections: 1, needsAttention: 1 },
        { day: "2026-10-02", inspections: 1, needsAttention: 0 },
      ],
    });
    // Both widgets share one inspection query.
    expect(db.inspection.findMany.mock.calls.filter(([a]) => !(a as { where: { reports?: unknown } }).where.reports)).toHaveLength(1);
  });

  it("'My inspections' shows only the viewer's own", async () => {
    inspections = [inspectionRow("mine", "2026-09-29T13:00:00Z", { inspectorId: "u-jordan" }), inspectionRow("theirs", "2026-09-29T17:00:00Z", { inspectorId: "u-pat" })];
    const ctx = createDashboardContext({ userId: "u-jordan", role: "INSPECTOR" }, NOW);
    const today = await loadWidget("today", ctx, defaultPreferences("INSPECTOR"));
    expect(today.key === "today" && today.events.map((e) => e.sourceId)).toEqual(["mine"]);
    // Tasks for Today are filtered to the assignee, too.
    expect(db.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ assigneeId: "u-jordan" }) }));
  });

  it("missing optional data (no customer, services, inspector, or property details) doesn't break anything", async () => {
    inspections = [inspectionRow("bare", "2026-09-29T13:00:00Z", { inspectorId: null, inspector: null, inspectionServices: [], transaction: { customers: [], realtors: [], invoices: [] } })];
    db.task.findMany.mockResolvedValue([
      { id: "t1", title: "Loose end", dueAt: new Date("2026-09-25T16:00:00Z"), completedAt: null, assigneeId: null, assignee: null, realtor: null, transaction: null },
    ]);
    db.reportDelivery.findMany.mockResolvedValue([]);
    db.emailMessage.findMany.mockResolvedValue([]);
    db.emailMessage.count.mockResolvedValue(0);
    db.invoice.findMany.mockResolvedValue([{ id: "inv", invoiceNumber: "INV-1", status: "SENT", dueAt: null, transactionId: "tx", items: [], payments: [], transaction: { customers: [] } }]);
    const data = await loadDashboard(admin, prefsWith(["today", "needsAttention", "myTasks", "outstandingInvoices"]), NOW);
    for (const key of ["today", "needsAttention", "myTasks", "outstandingInvoices"] as const) expect(data.widgets[key], key).not.toHaveProperty("error");
    expect(data.widgets.today).toMatchObject({ events: [expect.objectContaining({ subtitle: "No services selected", inspectorName: null })] });
    expect(data.widgets.myTasks).toMatchObject({ rows: [expect.objectContaining({ title: "Loose end", context: null, assigneeName: null, href: "/tasks" })] });
  });
});

describe("only what's visible and permitted is loaded", () => {
  it("hidden widgets aren't queried", async () => {
    inspections = [inspectionRow("a", "2026-09-29T13:00:00Z")];
    const data = await loadDashboard(admin, prefsWith(["today"]), NOW);
    expect(Object.keys(data.widgets)).toEqual(["today"]);
    expect(db.invoice.findMany).not.toHaveBeenCalled();
    expect(db.activityLog.findMany).not.toHaveBeenCalled();
    expect(db.lead.count).not.toHaveBeenCalled();
    expect(db.invoiceItem.aggregate).not.toHaveBeenCalled();
    expect(db.reportDelivery.findMany).not.toHaveBeenCalled();
  });

  it("a direct request for an unauthorized widget's data is refused on the server", async () => {
    denied.add("INSPECTOR:financial:read");
    const ctx = createDashboardContext({ userId: "u-jordan", role: "INSPECTOR" }, NOW);
    await expect(loadWidget("outstandingInvoices", ctx, defaultPreferences("INSPECTOR"))).rejects.toBeInstanceOf(ForbiddenError);
    // Even the shared loader refuses, whoever calls it.
    await expect(ctx.collectibleInvoices()).rejects.toBeInstanceOf(ForbiddenError);
    expect(db.invoice.findMany).not.toHaveBeenCalled();
  });

  it("a stored preference naming a restricted KPI doesn't get it calculated", async () => {
    denied.add("INSPECTOR:financial:read");
    db.inspection.count.mockResolvedValue(3);
    const prefs = { ...prefsWith(["snapshot"]), kpis: ["revenueMonth", "inspectionsWeek", "outstandingBalance"] } as DashboardPreferences;
    const data = await loadDashboard({ userId: "u-jordan", role: "INSPECTOR" }, prefs, NOW);
    expect(data.widgets.snapshot).toEqual({ key: "snapshot", kpis: [{ key: "inspectionsWeek", value: 3 }] });
    expect(db.invoiceItem.aggregate).not.toHaveBeenCalled();
    expect(db.invoice.findMany).not.toHaveBeenCalled();
  });

  it("one widget failing shows an error in that card only", async () => {
    db.activityLog.findMany.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    inspections = [inspectionRow("a", "2026-09-29T13:00:00Z")];
    const data = await loadDashboard(admin, prefsWith(["today", "recentActivity"]), NOW);
    expect(data.widgets.recentActivity).toEqual({ key: "recentActivity", error: "This section couldn't load. Refresh to try again." });
    expect(data.widgets.today).toMatchObject({ key: "today" });
    spy.mockRestore();
  });
});

describe("Recent Activity", () => {
  it("is built from real records, labelled, merged by time, and described with one query per entity type", async () => {
    db.activityLog.findMany.mockResolvedValue([
      { id: "l1", action: "inspection.scheduled", entityType: "Inspection", entityId: "i1", after: null, createdAt: new Date("2026-09-29T12:10:00Z"), actor: { name: "Olivia" } },
      { id: "l2", action: "inspection.rescheduled", entityType: "Inspection", entityId: "i2", after: null, createdAt: new Date("2026-09-29T12:00:00Z"), actor: null },
      { id: "l3", action: "invoice.payment_recorded", entityType: "Invoice", entityId: "inv1", after: { amount: "475.00" }, createdAt: new Date("2026-09-29T12:16:00Z"), actor: null },
      { id: "l4", action: "task.completed", entityType: "Task", entityId: "t1", after: null, createdAt: new Date("2026-09-28T20:00:00Z"), actor: null },
    ]);
    db.inspection.findMany.mockResolvedValue([
      { id: "i1", property: { addressLine1: "123 Main St", city: "Hickory" } },
      { id: "i2", property: { addressLine1: "455 Oak Ave", city: "Hickory" } },
    ]);
    db.invoice.findMany.mockResolvedValue([{ id: "inv1", invoiceNumber: "INV-9", transactionId: "tx9" }]);
    db.task.findMany.mockResolvedValue([{ id: "t1", title: "Thank-you call", realtor: { id: "r1", firstName: "Sarah", lastName: "Jones", preferredName: null } }]);
    db.reportVersion.findMany.mockResolvedValue([]);
    db.reportDelivery.findMany.mockResolvedValue([
      { id: "d1", recipientName: "Ava Chen", deliveredAt: new Date("2026-09-29T12:42:00Z"), report: { inspectionId: "i1", inspection: { property: { addressLine1: "123 Main St", city: "Hickory" } } } },
    ]);
    db.emailMessage.findMany.mockResolvedValue([
      { id: "m1", status: "DELIVERED", recipientName: "Ava Chen", sentAt: new Date("2026-09-29T11:57:00Z"), deliveredAt: new Date("2026-09-29T11:58:00Z"), simulated: false, automation: { name: "Inspection reminder" } },
    ]);

    const result = await loadWidget("recentActivity", createDashboardContext(admin, NOW), prefsWith(["recentActivity"]));
    expect(result.key === "recentActivity" && result.entries.map((e) => [e.label, e.detail])).toEqual([
      ["Report delivered", "123 Main St, Hickory · to Ava Chen"],
      ["Payment received", "$475.00 · Invoice INV-9"],
      ["Inspection scheduled", "123 Main St, Hickory"],
      ["Inspection rescheduled", "455 Oak Ave, Hickory"],
      ["Inspection reminder delivered", "To Ava Chen"],
      ["Realtor follow-up completed", "Sarah Jones · Thank-you call"],
    ]);
    // No N+1: the two inspection rows were described by a single query.
    expect(db.inspection.findMany).toHaveBeenCalledTimes(1);
    expect(db.inspection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["i1", "i2"] } } }));
  });

  it("payments are left out for roles without financial access", async () => {
    denied.add("INSPECTOR:financial:read");
    db.activityLog.findMany.mockResolvedValue([]);
    db.reportVersion.findMany.mockResolvedValue([]);
    db.reportDelivery.findMany.mockResolvedValue([]);
    db.emailMessage.findMany.mockResolvedValue([]);
    await loadWidget("recentActivity", createDashboardContext({ userId: "u-jordan", role: "INSPECTOR" }, NOW), defaultPreferences("INSPECTOR"));
    const where = db.activityLog.findMany.mock.calls[0][0].where;
    expect(where.action.in).not.toContain("invoice.payment_recorded");
    expect(where.action.in).toContain("inspection.scheduled");
    // Undoing a signature is shown as well as signing.
    expect(where.action.in).toEqual(expect.arrayContaining(["inspection.agreement_signed", "inspection.agreement_unsigned"]));
  });

  it("an entry whose record is gone still renders", async () => {
    db.activityLog.findMany.mockResolvedValue([{ id: "l1", action: "customer.created", entityType: "Customer", entityId: "gone", after: null, createdAt: NOW, actor: null }]);
    db.customer.findMany.mockResolvedValue([]);
    db.reportVersion.findMany.mockResolvedValue([]);
    db.reportDelivery.findMany.mockResolvedValue([]);
    db.emailMessage.findMany.mockResolvedValue([]);
    const result = await loadWidget("recentActivity", createDashboardContext(admin, NOW), prefsWith(["recentActivity"]));
    expect(result).toMatchObject({ entries: [{ label: "Customer added", detail: null, href: "/customers/gone" }] });
  });
});

describe("Needs Attention loading", () => {
  beforeEach(() => {
    db.reportDelivery.findMany.mockResolvedValue([]);
    db.emailMessage.findMany.mockResolvedValue([]);
    db.emailMessage.count.mockResolvedValue(0);
    db.invoice.findMany.mockResolvedValue([]);
  });

  it("queries only unresolved records: open tasks, failed deliveries with no success since, failed operational email", async () => {
    await loadWidget("needsAttention", createDashboardContext(admin, NOW), prefsWith(["needsAttention"]));
    expect(db.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ completedAt: null }) }));
    expect(db.reportDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "FAILED", report: { deliveredAt: null, deliveries: { none: { status: { in: ["SENT", "VIEWED"] } } } } } })
    );
    expect(db.emailMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ["FAILED", "BOUNCED"] }, category: "TRANSACTIONAL" }) }));
    expect(db.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } } }));
  });

  it("optional categories the user hid aren't loaded; required ones can't be hidden", async () => {
    const prefs = prefsWith(["needsAttention"], { hiddenAttention: ["taskOverdue", "realtorFollowUp", "emailReview"] });
    await loadWidget("needsAttention", createDashboardContext(admin, NOW), prefs);
    expect(db.task.findMany).not.toHaveBeenCalled();
    expect(db.emailMessage.count).not.toHaveBeenCalled();
    // Required: still checked.
    expect(db.reportDelivery.findMany).toHaveBeenCalled();
    expect(db.emailMessage.findMany).toHaveBeenCalled();
  });

  it("the Realtor follow-up comes from the existing Task records", async () => {
    db.task.findMany.mockResolvedValue([
      { id: "t7", title: "Thank-you after inspection", dueAt: new Date("2026-09-27T16:00:00Z"), completedAt: null, assigneeId: "u-admin", assignee: { name: "Admin" }, realtor: { id: "r1", firstName: "Sarah", lastName: "Jones", preferredName: null, phone: null }, transaction: null },
    ]);
    const result = await loadWidget("needsAttention", createDashboardContext(admin, NOW), prefsWith(["needsAttention"]));
    expect(result).toMatchObject({ items: [expect.objectContaining({ category: "realtorFollowUp", sourceType: "Task", sourceId: "t7", subject: "Sarah Jones", href: "/realtors/r1" })] });
  });

  it("financial attention isn't loaded without financial access", async () => {
    denied.add("OWNER_ADMIN:financial:read");
    await loadWidget("needsAttention", createDashboardContext(admin, NOW), prefsWith(["needsAttention"]));
    expect(db.invoice.findMany).not.toHaveBeenCalled();
  });

  it("an overdue invoice appears; once paid it doesn't", async () => {
    const row = (status: string, payments: { amount: Prisma.Decimal }[]) => ({
      id: "inv1",
      invoiceNumber: "INV-1",
      status,
      dueAt: new Date("2026-09-20T16:00:00Z"),
      transactionId: "tx1",
      items: [{ amount: new Prisma.Decimal("475") }],
      payments,
      transaction: { customers: [{ primaryContact: true, customer: { firstName: "John", lastName: "Smith" } }] },
    });
    db.invoice.findMany.mockResolvedValue([row("OVERDUE", [])]);
    const before = await loadWidget("needsAttention", createDashboardContext(admin, NOW), prefsWith(["needsAttention"]));
    expect(before).toMatchObject({ items: [expect.objectContaining({ title: "Payment overdue", subject: "John Smith • $475.00" })] });

    db.invoice.findMany.mockResolvedValue([row("PAID", [{ amount: new Prisma.Decimal("475") }])]);
    const after = await loadWidget("needsAttention", createDashboardContext(admin, NOW), prefsWith(["needsAttention"]));
    expect(after).toMatchObject({ items: [] });
  });
});

describe("Email & Task Actions", () => {
  const email = (id: string, status: string, over: Record<string, unknown> = {}) => ({
    id,
    status,
    subject: `Subject ${id}`,
    recipientName: "Ava Chen",
    statusReason: status === "FAILED" ? "Provider timeout" : null,
    createdAt: new Date("2026-09-27T12:00:00Z"),
    updatedAt: new Date("2026-09-28T12:00:00Z"),
    realtorId: null,
    customerId: "c1",
    inspectionId: "i1",
    transactionId: "t1",
    automation: { name: "Inspection confirmation" },
    ...over,
  });
  const task = (id: string, assigneeId: string, over: Record<string, unknown> = {}) => ({
    id,
    title: `Task ${id}`,
    dueAt: new Date("2026-09-28T16:00:00Z"),
    completedAt: null,
    assigneeId,
    assignee: { name: assigneeId },
    realtor: null,
    transaction: null,
    ...over,
  });

  it("lists failed/bounced email first, then drafts to review, with the context that reopens each in the composer", async () => {
    db.emailMessage.findMany.mockImplementation(async (args: { where: { status: unknown } }) =>
      args.where.status === "DRAFT"
        ? [email("d1", "DRAFT", { realtorId: "r1", customerId: null, inspectionId: null, transactionId: null, automation: { name: "Realtor thank-you" } })]
        : [email("f1", "FAILED"), email("b1", "BOUNCED", { statusReason: "Hard bounce" })]
    );
    db.emailMessage.count.mockResolvedValueOnce(2).mockResolvedValueOnce(4);
    const result = await loadWidget("actionQueue", createDashboardContext(admin, NOW), prefsWith(["actionQueue"]));
    expect(result).toMatchObject({
      key: "actionQueue",
      emailTotal: 6,
      emails: [
        { id: "f1", kind: "failed", detail: "Provider timeout", context: { kind: "inspection", id: "i1" }, href: "/email/messages/f1" },
        { id: "b1", kind: "bounced", detail: "Hard bounce" },
        { id: "d1", kind: "review", detail: "Realtor thank-you", context: { kind: "realtor", id: "r1" } },
      ],
    });
    // Drafts: the same queue as Email → Review. Failures: recent, not campaign mail.
    expect(db.emailMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "DRAFT", campaignId: null }, take: 6 }));
    expect(db.emailMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ["FAILED", "BOUNCED"] }, campaignId: null, updatedAt: { gte: new Date("2026-09-15T15:00:00Z") } } })
    );
  });

  it("roles without email access get tasks only — email isn't queried", async () => {
    denied.add("INSPECTOR:email:view");
    db.task.findMany.mockResolvedValue([task("t1", "u-jordan")]);
    const result = await loadWidget("actionQueue", createDashboardContext({ userId: "u-jordan", role: "INSPECTOR" }, NOW), defaultPreferences("INSPECTOR"));
    expect(result).toMatchObject({ emails: null, emailTotal: 0, tasks: [{ id: "t1" }], taskTotal: 1 });
    expect(db.emailMessage.findMany).not.toHaveBeenCalled();
    expect(db.emailMessage.count).not.toHaveBeenCalled();
  });

  it("'My tasks' shows only the viewer's; a Realtor task knows whether the Realtor can be emailed", async () => {
    db.emailMessage.findMany.mockResolvedValue([]);
    db.emailMessage.count.mockResolvedValue(0);
    db.task.findMany.mockResolvedValue([
      task("mine", "u-admin", { realtor: { id: "r1", firstName: "Sarah", lastName: "Jones", preferredName: null, phone: null, email: "sarah@example.com" } }),
      task("theirs", "u-pat"),
    ]);
    const prefs = prefsWith(["actionQueue"], { options: { actionQueue: { scope: "mine" } } });
    const result = await loadWidget("actionQueue", createDashboardContext(admin, NOW), prefs);
    expect(result).toMatchObject({ taskTotal: 1, tasks: [{ id: "mine", realtorEmail: true, overdue: true, realtor: { id: "r1", name: "Sarah Jones" } }] });
  });
});
