import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  createRealtorQuick,
  updateRealtorProfile,
  changeRealtorBrokerage,
  changeRealtorBrokerageInline,
  createRealtorTask,
  logRealtorCommunication,
  linkReferralSourceToRealtor,
  createReferralSourceForRealtor,
  getRealtorPreview,
  saveRealtorPreviewSections,
} from "./actions";

type Fn = ReturnType<typeof vi.fn>;
const mockAuth = vi.mocked(auth);
const db = prisma as unknown as Record<string, Record<string, Fn>> & { $transaction: Fn };

const staff = { user: { id: "user-1", role: "OFFICE_STAFF" } };
const inspector = { user: { id: "user-2", role: "INSPECTOR" } };

const existingRealtor = {
  id: "r1",
  firstName: "Sarah",
  lastName: "Jones",
  preferredName: null,
  email: "sarah@kw.test",
  phone: "8285550101",
  preferredContactMethod: null,
  notes: null,
  brokerageId: "brok-1",
  archivedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(staff as never);
});

describe("createRealtorQuick", () => {
  it("rejects a role without crm:write (server-side RBAC)", async () => {
    mockAuth.mockResolvedValue(inspector as never);
    await expect(createRealtorQuick({ firstName: "Jamie", lastName: "Rivera" })).rejects.toThrow();
    expect(db.realtor.create).not.toHaveBeenCalled();
  });

  it("rejects when there is no session", async () => {
    mockAuth.mockResolvedValue(null as never);
    await expect(createRealtorQuick({ firstName: "Jamie", lastName: "Rivera" })).rejects.toThrow();
  });

  it("creates a realtor with only a name, storing every optional field as null (non-blocking data)", async () => {
    db.realtor.findMany.mockResolvedValue([]);
    db.realtor.create.mockResolvedValue({ id: "r-new", createdAt: new Date("2026-01-01") });

    const result = await createRealtorQuick({ firstName: " Jamie ", lastName: "Rivera", email: "", phone: "" });

    expect(result).toEqual({ ok: true, data: { id: "r-new" } });
    expect(db.realtor.create).toHaveBeenCalledWith({
      data: { firstName: "Jamie", lastName: "Rivera", preferredName: null, email: null, phone: null, brokerageId: null },
    });
    expect(db.realtorBrokerageHistory.create).not.toHaveBeenCalled();
  });

  it("requires a first and last name", async () => {
    const result = await createRealtorQuick({ firstName: "Jamie", lastName: " " });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/first and last name/i) });
    expect(db.realtor.create).not.toHaveBeenCalled();
  });

  it("rejects a malformed phone or email without writing anything", async () => {
    expect(await createRealtorQuick({ firstName: "A", lastName: "B", phone: "555" })).toMatchObject({ ok: false });
    expect(await createRealtorQuick({ firstName: "A", lastName: "B", email: "nope" })).toMatchObject({ ok: false });
    expect(db.realtor.create).not.toHaveBeenCalled();
  });

  it("stops for review when a possible duplicate exists, and never merges", async () => {
    db.realtor.findMany.mockResolvedValue([
      { id: "r1", firstName: "Sarah", lastName: "Jones", email: "sarah@kw.test", phone: null, brokerageId: null, brokerage: null },
    ]);

    const result = await createRealtorQuick({ firstName: "Sara", lastName: "Jonas", email: "SARAH@kw.test" });

    expect(result).toMatchObject({ ok: false, duplicates: [{ id: "r1", reasons: ["email"], exact: true }] });
    expect(db.realtor.create).not.toHaveBeenCalled();
    expect(db.realtor.update).not.toHaveBeenCalled();
  });

  it("creates anyway once the user has reviewed the matches", async () => {
    db.realtor.create.mockResolvedValue({ id: "r-new", createdAt: new Date() });
    const result = await createRealtorQuick({ firstName: "Sara", lastName: "Jonas", email: "sarah@kw.test", confirmDuplicates: true });
    expect(result).toEqual({ ok: true, data: { id: "r-new" } });
    expect(db.realtor.findMany).not.toHaveBeenCalled();
  });

  it("opens a brokerage history row and audits the creation in the same transaction", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    db.realtor.findMany.mockResolvedValue([]);
    db.realtor.create.mockResolvedValue({ id: "r-new", createdAt });

    await createRealtorQuick({ firstName: "Jamie", lastName: "Rivera", brokerageId: "brok-1", phone: "(828) 555-0101" });

    expect(db.realtor.create).toHaveBeenCalledWith({ data: expect.objectContaining({ phone: "8285550101", brokerageId: "brok-1" }) });
    expect(db.realtorBrokerageHistory.create).toHaveBeenCalledWith({ data: { realtorId: "r-new", brokerageId: "brok-1", startDate: createdAt } });
    expect(db.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "realtor.created", entityType: "Realtor", entityId: "r-new", actorId: "user-1" }),
    });
  });
});

describe("updateRealtorProfile", () => {
  it("rejects a role without crm:write (server-side RBAC)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "REPORTING_ANALYST" } } as never);
    await expect(updateRealtorProfile("r1", { email: "x@y.test" })).rejects.toThrow();
    expect(db.realtor.update).not.toHaveBeenCalled();
  });

  it("returns a validation error for a bad email without writing", async () => {
    db.realtor.findUnique.mockResolvedValue(existingRealtor);
    const result = await updateRealtorProfile("r1", { email: "not-an-email" });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/email/i) });
    expect(db.realtor.update).not.toHaveBeenCalled();
  });

  it("allows clearing the email — a realtor without email is still a valid record", async () => {
    db.realtor.findUnique.mockResolvedValue(existingRealtor);
    const result = await updateRealtorProfile("r1", { email: "  " });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(db.realtor.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { email: null } });
  });

  it("writes and audits only the fields that actually changed", async () => {
    db.realtor.findUnique.mockResolvedValue(existingRealtor);
    await updateRealtorProfile("r1", { phone: "(828) 555-0199", email: "sarah@kw.test" });

    expect(db.realtor.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { phone: "8285550199" } });
    expect(db.activityLog.create).toHaveBeenCalledTimes(1);
    expect(db.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "realtor.contact_updated",
        before: { phone: "8285550101" },
        after: { phone: "8285550199" },
      }),
    });
  });

  it("logs notes changes under their own audit action", async () => {
    db.realtor.findUnique.mockResolvedValue(existingRealtor);
    await updateRealtorProfile("r1", { notes: "Prefers mornings", phone: "8285550199" });
    const actions = db.activityLog.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toEqual(expect.arrayContaining(["realtor.notes_updated", "realtor.contact_updated"]));
  });

  it("no longer accepts an active/inactive status", async () => {
    db.realtor.findUnique.mockResolvedValue(existingRealtor);
    expect(await updateRealtorProfile("r1", { active: false } as never)).toMatchObject({ ok: false });
    expect(db.realtor.update).not.toHaveBeenCalled();
  });

  it("refuses fields outside the allow-list", async () => {
    db.realtor.findUnique.mockResolvedValue(existingRealtor);
    const result = await updateRealtorProfile("r1", { brokerageId: "brok-2" } as never);
    expect(result).toMatchObject({ ok: false });
    expect(db.realtor.update).not.toHaveBeenCalled();
  });

  it("does nothing for an archived realtor", async () => {
    db.realtor.findUnique.mockResolvedValue({ ...existingRealtor, archivedAt: new Date() });
    expect(await updateRealtorProfile("r1", { notes: "x" })).toMatchObject({ ok: false });
    expect(db.realtor.update).not.toHaveBeenCalled();
  });
});

describe("changing brokerage", () => {
  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue(inspector as never);
    const form = new FormData();
    form.set("brokerageId", "brok-2");
    await expect(changeRealtorBrokerage("r1", form)).rejects.toThrow();
    await expect(changeRealtorBrokerageInline("r1", "brok-2")).rejects.toThrow();
    expect(db.realtor.update).not.toHaveBeenCalled();
  });

  it("closes the open history row and opens a new one — history is never deleted or overwritten", async () => {
    db.realtor.findUniqueOrThrow.mockResolvedValue({ brokerageId: "brok-1" });
    const result = await changeRealtorBrokerageInline("r1", "brok-2");

    expect(result).toEqual({ ok: true, data: undefined });
    expect(db.realtorBrokerageHistory.updateMany).toHaveBeenCalledWith({
      where: { realtorId: "r1", endDate: null },
      data: { endDate: expect.any(Date) },
    });
    expect(db.realtorBrokerageHistory.create).toHaveBeenCalledWith({
      data: { realtorId: "r1", brokerageId: "brok-2", startDate: expect.any(Date) },
    });
    expect(db.realtorBrokerageHistory.delete).not.toHaveBeenCalled();
    expect(db.realtorBrokerageHistory.deleteMany).not.toHaveBeenCalled();
    // Past transactions keep their own brokerage snapshot — a move never touches them.
    expect(db.transactionRealtor.updateMany).not.toHaveBeenCalled();
    expect(db.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "realtor.brokerage_changed", before: { brokerageId: "brok-1" }, after: { brokerageId: "brok-2" } }),
    });
  });

  it("is a no-op when moving to the brokerage they're already at", async () => {
    db.realtor.findUniqueOrThrow.mockResolvedValue({ brokerageId: "brok-1" });
    await changeRealtorBrokerageInline("r1", "brok-1");
    expect(db.realtorBrokerageHistory.updateMany).not.toHaveBeenCalled();
    expect(db.realtorBrokerageHistory.create).not.toHaveBeenCalled();
  });

  it("requires a brokerage", async () => {
    expect(await changeRealtorBrokerageInline("r1", "")).toMatchObject({ ok: false });
  });
});

describe("createRealtorTask", () => {
  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue(inspector as never);
    await expect(createRealtorTask("r1", { title: "Follow up", dueDate: "" })).rejects.toThrow();
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("creates an ordinary Task linked to the realtor (no separate follow-up system)", async () => {
    db.realtor.findUnique.mockResolvedValue({ archivedAt: null });
    const result = await createRealtorTask("r1", { title: " Follow up ", dueDate: "2026-10-03" });

    expect(result).toEqual({ ok: true, data: undefined });
    const data = db.task.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ title: "Follow up", realtorId: "r1", assigneeId: "user-1" });
    // Local noon, so the calendar day survives any timezone.
    expect(data.dueAt.getFullYear()).toBe(2026);
    expect(data.dueAt.getMonth()).toBe(9);
    expect(data.dueAt.getDate()).toBe(3);
  });

  it("validates title and date", async () => {
    expect(await createRealtorTask("r1", { title: "", dueDate: "" })).toMatchObject({ ok: false });
    expect(await createRealtorTask("r1", { title: "x", dueDate: "not-a-date" })).toMatchObject({ ok: false });
    expect(db.task.create).not.toHaveBeenCalled();
  });
});

describe("logRealtorCommunication", () => {
  it("logs against the realtor with the shared channel vocabulary", async () => {
    await logRealtorCommunication("r1", { channel: "Phone", direction: "OUTBOUND", summary: " Checked in " });
    expect(db.communication.create).toHaveBeenCalledWith({
      data: { realtorId: "r1", channel: "Phone", direction: "OUTBOUND", summary: "Checked in" },
    });
  });

  it("rejects unknown channels and empty summaries", async () => {
    expect(await logRealtorCommunication("r1", { channel: "Carrier pigeon", direction: "OUTBOUND", summary: "hi" })).toMatchObject({ ok: false });
    expect(await logRealtorCommunication("r1", { channel: "Phone", direction: "OUTBOUND", summary: " " })).toMatchObject({ ok: false });
    expect(db.communication.create).not.toHaveBeenCalled();
  });
});

describe("referral attribution", () => {
  it("won't re-point a referral source that belongs to another realtor", async () => {
    db.referralSource.findUnique.mockResolvedValue({ id: "rs1", realtorId: "someone-else" });
    const result = await linkReferralSourceToRealtor("r1", "rs1");
    expect(result).toMatchObject({ ok: false });
    expect(db.referralSource.update).not.toHaveBeenCalled();
  });

  it("links an unlinked source and audits it", async () => {
    db.referralSource.findUnique.mockResolvedValue({ id: "rs1", realtorId: null });
    await linkReferralSourceToRealtor("r1", "rs1");
    expect(db.referralSource.update).toHaveBeenCalledWith({ where: { id: "rs1" }, data: { realtorId: "r1" } });
    expect(db.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "realtor.referral_source_linked" }) });
  });

  it("creates at most one referral source per realtor", async () => {
    db.realtor.findUnique.mockResolvedValue(existingRealtor);
    db.referralSource.findFirst.mockResolvedValue({ id: "rs1", name: "Sarah Jones" });
    expect(await createReferralSourceForRealtor("r1")).toMatchObject({ ok: false });
    expect(db.referralSource.create).not.toHaveBeenCalled();
  });
});

describe("getRealtorPreview", () => {
  it("requires a signed-in session", async () => {
    mockAuth.mockResolvedValue(null as never);
    await expect(getRealtorPreview("r1")).rejects.toThrow();
    expect(db.realtor.findFirst).not.toHaveBeenCalled();
  });
});

describe("saveRealtorPreviewSections", () => {
  it("saves a normalized layout to the signed-in user's own record", async () => {
    mockAuth.mockResolvedValue(inspector as never);
    const result = await saveRealtorPreviewSections(["activity", "hacked", "nextAction"]);
    expect(result).toEqual({ ok: true, data: ["nextAction", "activity"] });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "user-2" }, data: { realtorPreviewSections: ["nextAction", "activity"] } });
  });

  it("requires a session", async () => {
    mockAuth.mockResolvedValue(null as never);
    await expect(saveRealtorPreviewSections(["contact"])).rejects.toThrow();
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
