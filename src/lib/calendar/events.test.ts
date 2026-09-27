import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { loadCalendarEvents } from "./events";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>> & { $queryRaw: Fn };
const WEEK = { start: "2026-09-27", end: "2026-10-04" };
const NOW = new Date("2026-09-27T14:00:00Z");

const inspection = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  status: "SCHEDULED",
  scheduledAt: new Date("2026-09-29T13:00:00Z"), // 9:00 AM EDT
  durationMinutes: 180,
  inspectorId: "u1",
  agreementSignedAt: new Date("2026-09-20"),
  property: { addressLine1: "123 Main Street", city: "Hickory" },
  inspector: { name: "Ed" },
  inspectionServices: [{ service: { name: "General Home Inspection" } }, { service: { name: "Radon" } }],
  transaction: {
    customers: [{ primaryContact: true, customer: { firstName: "John", lastName: "Smith", phone: "8285550101", email: null } }],
    realtors: [{ realtor: { firstName: "Sarah", lastName: "Jones", preferredName: "Sally" } }],
    invoices: [],
  },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_TIMEZONE", "America/New_York");
  for (const m of ["inspection", "appointment", "task", "transaction", "realtor", "invoice"]) db[m].findMany.mockResolvedValue([]);
  db.$queryRaw.mockResolvedValue([]);
});

const load = (layers: string[], over: Record<string, unknown> = {}) =>
  loadCalendarEvents({ ...WEEK, layers: layers as never, role: "OWNER_ADMIN", now: NOW, ...over });

describe("range-based aggregation", () => {
  it("queries only the visible range (plus the longest possible appointment) and only enabled layers", async () => {
    await load(["inspections"]);
    expect(db.inspection.findMany).toHaveBeenCalledTimes(1);
    const where = db.inspection.findMany.mock.calls[0][0].where;
    expect(where.scheduledAt.lt.toISOString()).toBe("2026-10-04T04:00:00.000Z"); // Oct 4 midnight, New York
    expect(where.scheduledAt.gte.toISOString()).toBe("2026-09-26T16:00:00.000Z"); // Sep 27 midnight − 12h
    for (const m of ["task", "transaction", "realtor", "invoice", "appointment"]) expect(db[m].findMany).not.toHaveBeenCalled();
  });

  it("drops an inspection that finished before the range opened", async () => {
    db.inspection.findMany.mockResolvedValue([inspection({ scheduledAt: new Date("2026-09-26T21:00:00Z"), durationMinutes: 60 })]);
    expect(await load(["inspections"])).toEqual([]);
  });
});

describe("inspection events", () => {
  it("appear at the right business-time date and time, with duration, services, and inspector", async () => {
    db.inspection.findMany.mockResolvedValue([inspection()]);
    const [e] = await load(["inspections"]);
    expect(e).toMatchObject({
      type: "inspection",
      sourceId: "i1",
      day: "2026-09-29",
      start: "2026-09-29T13:00:00.000Z",
      end: "2026-09-29T16:00:00.000Z",
      title: "123 Main Street, Hickory",
      subtitle: "General Home Inspection + Radon",
      inspectorName: "Ed",
      warnings: [],
      href: "/inspections/i1",
      movable: true,
    });
    expect(e.searchText).toContain("john smith");
    expect(e.searchText).toContain("sally jones");
  });

  it("flags overlapping inspections for the same inspector as a conflict", async () => {
    db.inspection.findMany.mockResolvedValue([inspection(), inspection({ id: "i2", scheduledAt: new Date("2026-09-29T15:00:00Z") })]);
    const events = await load(["inspections"]);
    expect(events.every((e) => e.warnings[0]?.code === "conflict")).toBe(true);
  });

  it("aren't draggable for a role that can't reschedule", async () => {
    db.inspection.findMany.mockResolvedValue([inspection()]);
    const [e] = await load(["inspections"], { role: "INSPECTOR" });
    expect(e.movable).toBe(false);
  });
});

describe("tasks and realtor events", () => {
  const task = (over: Record<string, unknown>) => ({
    id: "t1",
    title: "Collect payment",
    dueAt: new Date("2026-09-30T16:00:00Z"),
    realtor: null,
    transaction: null,
    assignee: { name: "Ed" },
    ...over,
  });

  it("a task appears only when the Tasks layer is on, as an all-day item on its due day", async () => {
    db.task.findMany.mockImplementation(async ({ where }: { where: { realtorId: unknown } }) => (where.realtorId === null ? [task({})] : []));
    expect(await load(["inspections"])).toEqual([]);
    const [e] = await load(["tasks"]);
    expect(e).toMatchObject({ type: "task", layer: "tasks", allDay: true, day: "2026-09-30", href: "/tasks" });
  });

  it("a realtor follow-up appears on the Realtor layer (not Tasks) and opens the realtor", async () => {
    const followUp = task({ id: "t2", title: "Send market update", realtor: { id: "r1", firstName: "Sarah", lastName: "Jones", preferredName: "Sally", brokerage: { name: "Keller Williams" } } });
    db.task.findMany.mockImplementation(async ({ where }: { where: { realtorId: unknown } }) => (where.realtorId === null ? [] : [followUp]));
    expect(await load(["tasks"])).toEqual([]);
    const [e] = await load(["realtors"]);
    expect(e).toMatchObject({ type: "realtorFollowUp", layer: "realtors", subtitle: "Sally Jones · Keller Williams", href: "/realtors/r1" });
  });

  it("a realtor with no birthday on file produces no event; a valid one lands on its day", async () => {
    expect(await load(["realtors"])).toEqual([]);
    db.realtor.findMany.mockResolvedValue([{ id: "r1", firstName: "Sarah", lastName: "Jones", preferredName: "Sally", birthdayMonth: 9, birthdayDay: 28, careerStartDate: null, relationshipStartDate: null, brokerage: { name: "KW" } }]);
    const events = await load(["realtors"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "birthday", day: "2026-09-28", title: "Birthday · Sally Jones", allDay: true });
    // The query only asks for month/days actually in range.
    const or = db.realtor.findMany.mock.calls.at(-1)![0].where.OR;
    expect(or).toContainEqual({ birthdayMonth: 9, birthdayDay: 28 });
    expect(or).not.toContainEqual({ birthdayMonth: 10, birthdayDay: 4 });
  });

  it("a Feb 29 birthday is observed on Feb 28 in a non-leap year", async () => {
    db.realtor.findMany.mockResolvedValue([{ id: "r1", firstName: "Leap", lastName: "Day", preferredName: null, birthdayMonth: 2, birthdayDay: 29, careerStartDate: null, relationshipStartDate: null, brokerage: null }]);
    const [e] = await loadCalendarEvents({ start: "2027-02-28", end: "2027-03-01", layers: ["realtors"], role: "OWNER_ADMIN", now: NOW });
    expect(e.day).toBe("2027-02-28");
  });

  it("anniversaries count whole years and never mark the start date itself", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "r1" }]);
    db.realtor.findMany.mockImplementation(async ({ where }: { where: { id?: unknown } }) =>
      where.id ? [{ id: "r1", firstName: "Sarah", lastName: "Jones", preferredName: null, birthdayMonth: null, birthdayDay: null, careerStartDate: new Date("2016-09-29T00:00:00Z"), relationshipStartDate: new Date("2026-09-30T00:00:00Z"), brokerage: null }] : []
    );
    const events = await load(["realtors"]);
    expect(events.map((e) => [e.type, e.day, e.title])).toEqual([["careerAnniversary", "2026-09-29", "10 years in real estate · Sarah Jones"]]);
  });
});

describe("deadlines", () => {
  it("a report deadline is the inspection day + turnaround and links to that inspection's report", async () => {
    db.inspection.findMany.mockResolvedValue([{ id: "i1", inspectorId: "u1", scheduledAt: new Date("2026-09-29T13:00:00Z"), property: { addressLine1: "123 Main Street", city: "Hickory" }, reports: [{ id: "rep1", status: "IN_PROGRESS" }], inspector: { name: "Ed" } }]);
    const [e] = await load(["reports"]);
    expect(e).toMatchObject({ type: "reportDue", sourceType: "InspectionReport", sourceId: "rep1", day: "2026-09-30", allDay: true, href: "/inspections/i1/report", subtitle: "Report in progress" });
    // Delivered reports are excluded in the query itself.
    expect(db.inspection.findMany.mock.calls[0][0].where.reports).toEqual({ none: { OR: [{ status: "DELIVERED" }, { deliveredAt: { not: null } }] } });
  });

  it("transaction dates are all-day on exactly the stored day — no time-zone shift", async () => {
    db.transaction.findMany.mockResolvedValue([
      { id: "t1", closingDate: new Date("2026-10-02T00:00:00Z"), inspectionDeadline: new Date("2026-09-27T00:00:00Z"), property: { addressLine1: "455 Oak Avenue", city: "Hickory" }, customers: [] },
    ]);
    const events = await load(["transactions"]);
    expect(events.map((e) => [e.type, e.day, e.allDay, e.start])).toEqual([
      ["inspectionDeadline", "2026-09-27", true, null],
      ["closing", "2026-10-02", true, null],
    ]);
    expect(db.transaction.findMany.mock.calls[0][0].where.OR[0].closingDate).toEqual({ gte: new Date("2026-09-27T00:00:00Z"), lt: new Date("2026-10-04T00:00:00Z") });
  });

  it("billing shows only invoices that still have money owed (paid and draft invoices never appear)", async () => {
    const inv = (id: string, status: string, paid: string) => ({
      id,
      invoiceNumber: id,
      status,
      dueAt: new Date("2026-09-30T16:00:00Z"),
      items: [{ amount: new Prisma.Decimal("450") }],
      payments: [{ amount: new Prisma.Decimal(paid) }],
      transaction: { id: "t1", property: null },
    });
    db.invoice.findMany.mockResolvedValue([inv("A", "SENT", "0"), inv("B", "SENT", "450")]);
    const events = await load(["billing"]);
    expect(events.map((e) => [e.title, e.subtitle])).toEqual([["Invoice A due", "$450.00 · No property"]]);
  });
});
