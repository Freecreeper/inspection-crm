import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email/system", () => ({ ensureEmailSystem: vi.fn(async () => {}), runEmailTick: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { primeEmailDb, type MockDb } from "@/test-utils/emailFixtures";
import { approveCampaign, retryEmail, saveCampaign, submitComposedEmail, submitCampaignForReview, updateAutomation } from "./actions";

const db = prisma as unknown as MockDb;
const mockAuth = vi.mocked(auth);
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: `u-${role}`, role } } as never);
let rows: Map<string, Record<string, unknown>>;

const realtor = { id: "r1", firstName: "Sarah", lastName: "Jones", preferredName: null, email: "sarah@kw.test", archivedAt: null, relationshipEmailsEnabled: true, marketingOptIn: false, marketingUnsubscribedAt: null, brokerage: null };

beforeEach(() => {
  vi.clearAllMocks();
  rows = primeEmailDb(db);
  db.realtor.findFirst.mockResolvedValue(realtor);
  db.realtor.findUnique.mockResolvedValue(realtor);
  as("OFFICE_STAFF");
});

const compose = (over: Record<string, unknown> = {}) => ({
  context: { kind: "realtor", id: "r1" },
  recipientKey: "realtor:r1",
  templateId: "tpl-realtor_follow_up",
  subject: "Checking in",
  body: "Hi {{realtor.firstName}}, checking in.",
  action: "send" as const,
  ...over,
});

describe("manual email", () => {
  it("requires email:send — an inspector can't send, and nothing is queued", async () => {
    as("INSPECTOR");
    await expect(submitComposedEmail(compose())).rejects.toThrow();
    expect(rows.size).toBe(0);
  });

  it("queues a MANUAL email to the server-resolved recipient", async () => {
    const result = await submitComposedEmail(compose());
    expect(result).toMatchObject({ ok: true, data: { status: "QUEUED" } });
    const [message] = [...rows.values()];
    expect(message).toMatchObject({ mode: "MANUAL", category: "RELATIONSHIP", recipientEmail: "sarah@kw.test", realtorId: "r1", bodyText: "Hi Sarah, checking in." });
    expect(db.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "email.manual_sent" }) });
  });

  it("ignores any recipient the server didn't offer for that record", async () => {
    const result = await submitComposedEmail(compose({ recipientKey: "customer:someone-else" }));
    expect(result).toEqual({ ok: false, error: "Pick a recipient." });
    expect(rows.size).toBe(0);
  });

  it("won't send with placeholders that have no value", async () => {
    const result = await submitComposedEmail(compose({ body: "Hi {{realtor.firstName}}, your inspection on {{inspection.date}}." }));
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/Inspection date/);
    expect(rows.size).toBe(0);
  });

  it("skips (without failing) when the recipient has no email", async () => {
    db.realtor.findFirst.mockResolvedValue({ ...realtor, email: null });
    db.realtor.findUnique.mockResolvedValue({ ...realtor, email: null });
    const result = await submitComposedEmail(compose());
    expect(result).toEqual({ ok: false, error: "Realtor email not provided" });
    expect([...rows.values()][0]).toMatchObject({ status: "SKIPPED" });
  });
});

describe("retrying a skipped email", () => {
  const skipped = (scheduledFor: Date | null) => ({
    id: "m1",
    status: "SKIPPED",
    category: "TRANSACTIONAL",
    recipientType: "CUSTOMER",
    recipientEmail: null,
    scheduledFor,
    customer: { email: "ava@example.test" },
    realtor: null,
  });

  it("a reminder whose send time is still ahead goes back to waiting, not straight out", async () => {
    db.emailMessage.findUnique.mockResolvedValue(skipped(new Date(Date.now() + 86_400_000)));
    db.emailMessage.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "m1", ...data }));
    expect(await retryEmail("m1")).toEqual({ ok: true, data: { status: "SCHEDULED" } });
    expect(db.emailMessage.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: expect.objectContaining({ status: "SCHEDULED", recipientEmail: "ava@example.test" }) });
  });

  it("anything already due is queued now", async () => {
    db.emailMessage.findUnique.mockResolvedValue(skipped(null));
    db.emailMessage.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "m1", ...data }));
    expect(await retryEmail("m1")).toEqual({ ok: true, data: { status: "QUEUED" } });
  });
});

describe("automation settings", () => {
  it("only an owner can change automations, and changes are audited", async () => {
    await expect(updateAutomation("inspection_reminder", { active: false, sendMode: "AUTOMATIC", config: {} })).rejects.toThrow();
    as("OWNER_ADMIN");
    db.automation.findUniqueOrThrow.mockResolvedValue({ id: "auto-1", active: true, sendMode: "AUTOMATIC", actions: {} });
    db.automation.update.mockResolvedValue({});
    const result = await updateAutomation("inspection_reminder", { active: false, sendMode: "AUTOMATIC", config: { hoursBefore: 48 } });
    expect(result.ok).toBe(true);
    expect(db.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "email.automation_disabled" }) });
  });

  it("rejects out-of-range settings", async () => {
    as("OWNER_ADMIN");
    const result = await updateAutomation("inspection_reminder", { active: true, sendMode: "AUTOMATIC", config: { hoursBefore: 10_000 } });
    expect(result.ok).toBe(false);
  });
});

describe("campaign approval", () => {
  const input = {
    name: "Sewer scope launch",
    category: "MARKETING" as const,
    templateId: "tpl-new_service_announcement",
    subject: "Now offering sewer scopes",
    body: "Hi {{realtor.firstName}}",
    audience: {},
  };

  it("office staff can create and submit, but only an owner can approve", async () => {
    db.emailCampaign.create.mockResolvedValue({ id: "camp-1", name: input.name, category: "MARKETING" });
    expect(await saveCampaign(null, input)).toEqual({ ok: true, data: { id: "camp-1" } });
    db.emailCampaign.updateMany.mockResolvedValue({ count: 1 });
    expect(await submitCampaignForReview("camp-1")).toEqual({ ok: true, data: undefined });

    await expect(approveCampaign("camp-1", { sendAt: null })).rejects.toThrow();
    as("OWNER_ADMIN");
    expect(await approveCampaign("camp-1", { sendAt: null })).toEqual({ ok: true, data: undefined });
    expect(db.emailCampaign.updateMany).toHaveBeenLastCalledWith({
      where: { id: "camp-1", status: "READY_FOR_REVIEW" },
      data: expect.objectContaining({ status: "SCHEDULED", approvedById: "u-OWNER_ADMIN" }),
    });
  });

  it("can't approve a campaign that hasn't been submitted for review", async () => {
    as("OWNER_ADMIN");
    db.emailCampaign.updateMany.mockResolvedValue({ count: 0 });
    expect(await approveCampaign("camp-1", { sendAt: null })).toMatchObject({ ok: false });
  });

  it("won't send marketing content labeled as relationship mail", async () => {
    const result = await saveCampaign(null, { ...input, category: "RELATIONSHIP" });
    expect(result).toEqual({ ok: false, error: "A marketing template can only be used in a marketing campaign." });
  });

  it("editing an approved-for-review campaign sends it back to draft", async () => {
    db.emailCampaign.findUnique.mockResolvedValue({ id: "camp-1", status: "READY_FOR_REVIEW" });
    db.emailCampaign.update.mockResolvedValue({});
    await saveCampaign("camp-1", input);
    expect(db.emailCampaign.update).toHaveBeenCalledWith({ where: { id: "camp-1" }, data: expect.objectContaining({ status: "DRAFT", submittedAt: null }) });
  });
});
