import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { primeEmailDb, TEMPLATES, type MockDb } from "@/test-utils/emailFixtures";
import type { EmailProvider, SendResult } from "./providers";
import { MAX_ATTEMPTS, processClaimedMessage, recoverInterruptedSends } from "./worker";

const db = prisma as unknown as MockDb;
const NOW = new Date("2026-09-27T12:00:00Z");

function fakeProvider(result: SendResult): EmailProvider & { send: ReturnType<typeof vi.fn> } {
  return { name: "fake", simulated: false, send: vi.fn(async () => result) };
}

let message: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-only-secret");
  primeEmailDb(db);
  message = {
    id: "m1",
    status: "SENDING",
    mode: "MANUAL",
    category: "RELATIONSHIP",
    recipientType: "REALTOR",
    recipientName: "Sarah Jones",
    recipientEmail: "sarah@kw.test",
    subject: "Checking in",
    bodyText: "Hi Sarah,\n\nChecking in.",
    template: null,
    templateId: null,
    guard: null,
    attempts: 1,
    realtorId: "r1",
    customerId: null,
    transactionId: null,
    inspectionId: null,
    invoiceId: null,
    reportDeliveryId: null,
    campaignId: null,
  };
  db.emailMessage.findUnique.mockImplementation(async () => message);
  db.emailMessage.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => Object.assign(message, data));
  db.realtor.findUnique.mockResolvedValue({ id: "r1", firstName: "Sarah", lastName: "Jones", archivedAt: null, relationshipEmailsEnabled: true, marketingOptIn: false, marketingUnsubscribedAt: null, brokerage: null });
  db.communication.create.mockResolvedValue({ id: "comm-1" });
});

describe("sending", () => {
  it("records SENT (never DELIVERED) and writes a Communication so it shows in the realtor's activity", async () => {
    const provider = fakeProvider({ ok: true, providerMessageId: "pm-1" });
    const outcome = await processClaimedMessage("m1", provider, db as never, NOW);

    expect(outcome.status).toBe("SENT");
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(db.communication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ channel: "Email", direction: "OUTBOUND", summary: "Checking in", realtorId: "r1" }),
    });
    expect(message).toMatchObject({ status: "SENT", providerMessageId: "pm-1", communicationId: "comm-1" });
    expect(message.status).not.toBe("DELIVERED");
  });

  it("adds an unsubscribe/preferences footer and headers to relationship mail", async () => {
    const provider = fakeProvider({ ok: true, providerMessageId: "pm-1" });
    await processClaimedMessage("m1", provider, db as never, NOW);
    const sent = provider.send.mock.calls[0][0];
    expect(sent.text).toContain("Manage your preferences:");
    expect(sent.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent.stream).toBe("transactional");
  });

  it("does nothing for a message that isn't claimed (no double send on a second pass)", async () => {
    message.status = "SENT";
    const provider = fakeProvider({ ok: true, providerMessageId: "pm-2" });
    await processClaimedMessage("m1", provider, db as never, NOW);
    expect(provider.send).not.toHaveBeenCalled();
  });
});

describe("failures and retries", () => {
  it("a temporary provider failure is retried later — not sent twice, not failed yet", async () => {
    const provider = fakeProvider({ ok: false, retryable: true, error: "Provider temporarily unavailable (HTTP 503)." });
    const outcome = await processClaimedMessage("m1", provider, db as never, NOW);

    expect(outcome.status).toBe("QUEUED");
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect((message.nextAttemptAt as Date).getTime()).toBeGreaterThan(NOW.getTime());
    expect(message.statusReason).toMatch(/Retry 2 of 5/);
    expect(db.communication.create).not.toHaveBeenCalled();
  });

  it("gives up after the retry budget, with the reason visible", async () => {
    message.attempts = MAX_ATTEMPTS;
    const outcome = await processClaimedMessage("m1", fakeProvider({ ok: false, retryable: true, error: "Provider down" }), db as never, NOW);
    expect(outcome).toEqual({ status: "FAILED", reason: "Provider down" });
  });

  it("never auto-retries when it can't tell whether the provider accepted it", async () => {
    const outcome = await processClaimedMessage("m1", fakeProvider({ ok: false, retryable: false, ambiguous: true, error: "Provider did not respond in time." }), db as never, NOW);
    expect(outcome.status).toBe("FAILED");
    expect(message.statusReason).toMatch(/Not retried automatically/);
  });

  it("an interrupted send is failed for a human to check, never silently resent", async () => {
    db.emailMessage.updateMany.mockResolvedValue({ count: 1 });
    await recoverInterruptedSends(db as never, NOW);
    expect(db.emailMessage.updateMany).toHaveBeenCalledWith({
      where: { status: "SENDING", sendingAt: { lt: new Date(NOW.getTime() - 10 * 60_000) } },
      data: expect.objectContaining({ status: "FAILED" }),
    });
  });

  it("a provider failure never touches the business record that triggered the email", async () => {
    message = { ...message, inspectionId: "i1", invoiceId: "inv-1" };
    await processClaimedMessage("m1", fakeProvider({ ok: false, retryable: false, error: "Provider rejected the email: bad address" }), db as never, NOW);
    expect(db.inspection.update).not.toHaveBeenCalled();
    expect(db.invoice.update).not.toHaveBeenCalled();
    expect(db.transaction.update).not.toHaveBeenCalled();
    expect(message.status).toBe("FAILED");
  });

  it("a recipient the provider refuses is suppressed, not retried", async () => {
    const outcome = await processClaimedMessage("m1", fakeProvider({ ok: false, retryable: false, suppressed: true, error: "Provider refused recipient" }), db as never, NOW);
    expect(outcome.status).toBe("SUPPRESSED");
    expect(db.emailSuppression.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ email: "sarah@kw.test", scope: "ALL" }) }));
  });
});

describe("checks at send time", () => {
  it("a stale guard cancels instead of sending", async () => {
    message.guard = { checks: [{ kind: "inspectionScheduled", inspectionId: "i1", scheduleVersion: 0 }] };
    db.inspection.findUnique.mockResolvedValue({ status: "SCHEDULED", scheduleVersion: 1, scheduledAt: NOW });
    const provider = fakeProvider({ ok: true, providerMessageId: "x" });
    const outcome = await processClaimedMessage("m1", provider, db as never, NOW);
    expect(outcome).toEqual({ status: "CANCELLED", reason: "Appointment changed after this email was written" });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("a paid invoice's queued reminder is dropped", async () => {
    message.guard = { checks: [{ kind: "invoiceCollectible", invoiceId: "inv-1" }] };
    db.invoice.findUnique.mockResolvedValue({ status: "PAID", items: [{ amount: 450 }], payments: [{ amount: 450 }] });
    const provider = fakeProvider({ ok: true, providerMessageId: "x" });
    const outcome = await processClaimedMessage("m1", provider, db as never, NOW);
    expect(outcome.status).toBe("CANCELLED");
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("re-checks preferences: turned-off relationship email is suppressed at send", async () => {
    db.realtor.findUnique.mockResolvedValue({ archivedAt: null, relationshipEmailsEnabled: false, marketingOptIn: false, marketingUnsubscribedAt: null });
    const provider = fakeProvider({ ok: true, providerMessageId: "x" });
    expect((await processClaimedMessage("m1", provider, db as never, NOW)).status).toBe("SUPPRESSED");
    expect(provider.send).not.toHaveBeenCalled();
  });
});

describe("report-ready email", () => {
  beforeEach(() => {
    const tpl = TEMPLATES.find((t) => t.key === "report_ready")!;
    message = {
      ...message,
      mode: "AUTOMATIC",
      category: "TRANSACTIONAL",
      recipientType: "OTHER",
      recipientName: "John Smith",
      recipientEmail: "john@example.com",
      realtorId: null,
      template: tpl,
      templateId: tpl.id,
      reportDeliveryId: "del-1",
      bodyText: tpl.body,
    };
    db.reportDelivery.findUnique.mockResolvedValue({ id: "del-1", recipientName: "John Smith", report: { reportNumber: "RPT-1", inspectionId: "i1" }, version: { versionNumber: 2 }, reportId: "rep-1" });
    db.reportDelivery.update.mockResolvedValue({ id: "del-1", reportId: "rep-1" });
  });

  it("links to that delivery's immutable version, minted at send time, and never stores the link", async () => {
    const provider = fakeProvider({ ok: true, providerMessageId: "pm-9" });
    await processClaimedMessage("m1", provider, db as never, NOW);

    // The link's token belongs to this delivery (which pins versionId) —
    // a fresh hash written to exactly that row.
    const mint = db.reportDelivery.update.mock.calls.find((c) => c[0].data.accessTokenHash);
    expect(mint?.[0].where).toEqual({ id: "del-1" });
    const sentText: string = provider.send.mock.calls[0][0].text;
    const link = sentText.match(/https?:\/\/\S+\/r\/(\S+)/);
    expect(link).not.toBeNull();
    expect(mint?.[0].data.accessTokenHash).not.toContain(link![1]);
    // Stored copy is redacted.
    expect(message.bodyText).not.toContain(link![1]);
    expect(message.bodyText).toContain("[secure link — created when sent]");
    // Delivery becomes SENT and the report DELIVERED only now.
    expect(db.reportDelivery.update).toHaveBeenCalledWith({ where: { id: "del-1" }, data: { status: "SENT", deliveredAt: NOW } });
    expect(db.inspectionReport.update).toHaveBeenCalledWith({ where: { id: "rep-1" }, data: { status: "DELIVERED", deliveredAt: NOW } });
  });
});
