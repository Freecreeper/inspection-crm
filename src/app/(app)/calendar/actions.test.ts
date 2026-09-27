import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/scheduling/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scheduling/service")>()),
  scheduleInspection: vi.fn(async () => ({ ok: true, data: { inspectionId: "i1", transactionId: "t1" } })),
  rescheduleInspection: vi.fn(async () => ({ ok: true, data: { changed: true, transactionId: "t1" } })),
  cancelInspection: vi.fn(async () => ({ ok: true, data: { changed: true, transactionId: "t1" } })),
}));
vi.mock("@/lib/calendar/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/calendar/events")>()),
  loadCalendarEvents: vi.fn(async () => []),
}));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import * as service from "@/lib/scheduling/service";
import { loadCalendarEvents } from "@/lib/calendar/events";
import {
  cancelInspectionAction,
  createAppointment,
  createBlockedTime,
  createCustomerQuick,
  createPropertyQuick,
  getCalendarEvents,
  removeBlockedTime,
  rescheduleInspectionAction,
  scheduleInspectionAction,
  setAgreementSigned,
} from "./actions";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;
const as = (role: string, id = `u-${role}`) => vi.mocked(auth).mockResolvedValue({ user: { id, role } } as never);

const minimal = { propertyId: "p1", day: "2026-09-29", time: "09:00" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_TIMEZONE", "America/New_York");
  as("OFFICE_STAFF");
  db.activityLog.create.mockResolvedValue({});
  db.user.findUnique.mockResolvedValue({ active: true });
});

describe("RBAC — enforced on the server, whatever the UI shows", () => {
  it("only owner/office can schedule; inspectors and analysts are refused before anything runs", async () => {
    for (const role of ["INSPECTOR", "REPORTING_ANALYST"]) {
      as(role);
      await expect(scheduleInspectionAction(minimal)).rejects.toThrow();
    }
    expect(service.scheduleInspection).not.toHaveBeenCalled();
    as("OFFICE_STAFF");
    expect(await scheduleInspectionAction(minimal)).toMatchObject({ ok: true });
  });

  it("only owner/office can reschedule — seeing the calendar isn't enough", async () => {
    as("INSPECTOR");
    await expect(rescheduleInspectionAction("i1", { day: "2026-09-30", time: "10:00" })).rejects.toThrow();
    expect(service.rescheduleInspection).not.toHaveBeenCalled();
    as("OWNER_ADMIN");
    await rescheduleInspectionAction("i1", { day: "2026-09-30", time: "10:00", notify: false });
    expect(service.rescheduleInspection).toHaveBeenCalledWith("i1", { day: "2026-09-30", time: "10:00", notify: false }, "u-OWNER_ADMIN");
  });

  it("analysts can view but not cancel; inspectors keep the ability to cancel", async () => {
    as("REPORTING_ANALYST");
    await expect(cancelInspectionAction("i1", {})).rejects.toThrow();
    expect(await getCalendarEvents({ start: "2026-09-27", end: "2026-10-04", layers: ["inspections"] })).toEqual({ ok: true, data: [] });
    as("INSPECTOR");
    expect(await cancelInspectionAction("i1", { notify: true })).toMatchObject({ ok: true });
  });

  it("inspectors may block only their own time", async () => {
    as("INSPECTOR", "u-ed");
    expect(await createBlockedTime({ userId: "u-pat", title: "Off", day: "2026-09-29", startTime: "09:00", endTime: "12:00" })).toEqual({ ok: false, error: "You can only block your own time." });
    db.appointment.create.mockResolvedValue({ id: "b1" });
    expect(await createBlockedTime({ userId: "u-ed", title: "Dentist", day: "2026-09-29", startTime: "09:00", endTime: "10:30" })).toEqual({ ok: true, data: { id: "b1" } });
    expect(db.appointment.create).toHaveBeenCalledWith({
      data: { kind: "BLOCK", userId: "u-ed", title: "Dentist", startAt: new Date("2026-09-29T13:00:00Z"), endAt: new Date("2026-09-29T14:30:00Z") },
    });
    expect(db.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "calendar.block_created" }) });

    db.appointment.findUnique.mockResolvedValue({ id: "b2", userId: "u-pat", cancelledAt: null });
    expect(await removeBlockedTime("b2")).toEqual({ ok: false, error: "You can only change your own blocked time." });
  });

  it("only CRM writers can mark an agreement signed, and it's audited", async () => {
    as("INSPECTOR");
    await expect(setAgreementSigned("i1", true)).rejects.toThrow();
    as("OFFICE_STAFF");
    db.inspection.findUnique.mockResolvedValue({ agreementSignedAt: null });
    expect(await setAgreementSigned("i1", true)).toEqual({ ok: true, data: undefined });
    expect(db.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "inspection.agreement_signed", entityId: "i1" }) });
  });
});

describe("validation", () => {
  it("calendar ranges are bounded — no loading years of history in one request", async () => {
    expect(await getCalendarEvents({ start: "2026-01-01", end: "2026-12-31", layers: ["inspections"] })).toEqual({ ok: false, error: "Invalid range." });
    expect(await getCalendarEvents({ start: "2026-10-04", end: "2026-09-27", layers: [] })).toEqual({ ok: false, error: "Invalid range." });
    // Four months (the planning view) is the widest allowed.
    expect(await getCalendarEvents({ start: "2026-09-01", end: "2027-01-01", layers: [] })).toEqual({ ok: true, data: [] });
    await getCalendarEvents({ start: "2026-09-27", end: "2026-10-04", layers: ["inspections", "bogus"] });
    expect(loadCalendarEvents).toHaveBeenCalledWith(expect.objectContaining({ layers: ["inspections"] }));
  });

  it("schedule input is validated before reaching the service", async () => {
    expect(await scheduleInspectionAction({ ...minimal, day: "2026-02-30" })).toMatchObject({ ok: false, error: "Pick a valid date." });
    expect(await scheduleInspectionAction({ ...minimal, propertyId: "" })).toMatchObject({ ok: false, error: "Pick a property." });
    expect(service.scheduleInspection).not.toHaveBeenCalled();
  });

  it("a transaction-page appointment reads its times in the business zone", async () => {
    const f = new FormData();
    f.set("title", "Walkthrough");
    f.set("startAt", "2026-12-15T09:00");
    f.set("endAt", "2026-12-15T10:00");
    db.appointment.create.mockResolvedValue({ id: "a1" });
    await createAppointment(f);
    expect(db.appointment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ startAt: new Date("2026-12-15T14:00:00Z"), endAt: new Date("2026-12-15T15:00:00Z") }) });
  });
});

describe("create while scheduling", () => {
  it("a new customer needs only a name, and likely duplicates are offered instead of created", async () => {
    db.customer.findMany.mockResolvedValue([{ id: "c1", firstName: "John", lastName: "Smith", email: null, phone: null }]);
    const result = await createCustomerQuick({ firstName: "John", lastName: "Smith" });
    expect(result).toMatchObject({ ok: false, duplicates: [{ id: "c1", reasons: ["name"] }] });
    expect(db.customer.create).not.toHaveBeenCalled();

    db.customer.create.mockResolvedValue({ id: "c9" });
    expect(await createCustomerQuick({ firstName: "John", lastName: "Smith", confirmDuplicates: true })).toMatchObject({ ok: true, data: { id: "c9", label: "John Smith" } });
    expect(db.customer.create).toHaveBeenCalledWith({ data: { firstName: "John", lastName: "Smith", email: null, phone: null } });
  });

  it("a new property is validated and duplicate-checked by normalized address", async () => {
    expect(await createPropertyQuick({ addressLine1: "1 Oak", city: "Hickory", state: "North Carolina", zip: "28601" })).toMatchObject({ ok: false });
    db.property.findMany.mockResolvedValue([{ id: "p1", addressLine1: "12 Oak Avenue", addressLine2: null, city: "Hickory", state: "NC", zip: "28601" }]);
    expect(await createPropertyQuick({ addressLine1: "12 oak ave", city: "Hickory", state: "nc", zip: "28601" })).toMatchObject({ ok: false, duplicates: [{ id: "p1" }] });
    expect(db.property.create).not.toHaveBeenCalled();
  });

  it("creating needs CRM write access", async () => {
    as("INSPECTOR");
    await expect(createCustomerQuick({ firstName: "A", lastName: "B" })).rejects.toThrow();
    await expect(createPropertyQuick({ addressLine1: "1 A St", city: "X", state: "NC", zip: "28601" })).rejects.toThrow();
  });
});
