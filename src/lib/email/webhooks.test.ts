import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import type { MockDb } from "@/test-utils/emailFixtures";
import { parsePostmarkEvent, processPostmarkPayload, verifyWebhookAuth } from "./webhooks";

const db = prisma as unknown as MockDb;
const message = { id: "m1", recipientEmail: "john@example.com", status: "SENT" };

beforeEach(() => {
  vi.clearAllMocks();
  db.emailMessage.findUnique.mockResolvedValue(message);
  db.emailMessage.updateMany.mockResolvedValue({ count: 1 });
  db.emailEvent.create.mockResolvedValue({});
});

describe("webhook authentication", () => {
  const config = { webhookUsername: "pm", webhookPassword: "s3cret" } as never;
  it("accepts only the configured Basic credentials", () => {
    expect(verifyWebhookAuth(`Basic ${Buffer.from("pm:s3cret").toString("base64")}`, config)).toBe(true);
    expect(verifyWebhookAuth(`Basic ${Buffer.from("pm:wrong").toString("base64")}`, config)).toBe(false);
    expect(verifyWebhookAuth(null, config)).toBe(false);
  });
  it("rejects everything when no credentials are configured", () => {
    expect(verifyWebhookAuth(`Basic ${Buffer.from(":").toString("base64")}`, { webhookUsername: null, webhookPassword: null } as never)).toBe(false);
  });
});

describe("processPostmarkPayload", () => {
  const delivery = { RecordType: "Delivery", MessageID: "pm-1", DeliveredAt: "2026-09-28T12:02:00Z", Recipient: "john@example.com", Metadata: { emailMessageId: "m1" } };

  it("a delivery event marks the email DELIVERED — only from SENT/SENDING", async () => {
    await processPostmarkPayload(delivery);
    expect(db.emailMessage.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", status: { in: ["SENDING", "SENT"] } },
      data: { status: "DELIVERED", deliveredAt: new Date("2026-09-28T12:02:00Z") },
    });
  });

  it("an event claiming to be about a simulated send can't change its status", async () => {
    db.emailMessage.findUnique.mockResolvedValue({ ...message, simulated: true });
    await processPostmarkPayload(delivery);
    expect(db.emailEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ emailMessageId: null }) });
    expect(db.emailMessage.updateMany).not.toHaveBeenCalled();
  });

  it("a duplicate webhook is recognized by its key and changes nothing", async () => {
    db.emailEvent.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }));
    const result = await processPostmarkPayload(delivery);
    expect(result.duplicate).toBe(true);
    expect(db.emailMessage.updateMany).not.toHaveBeenCalled();
  });

  it("the same event always maps to the same key", () => {
    expect(parsePostmarkEvent(delivery).key).toBe(parsePostmarkEvent({ ...delivery }).key);
  });

  it("a hard bounce marks BOUNCED and suppresses the address for everything", async () => {
    await processPostmarkPayload({ RecordType: "Bounce", ID: 42, Type: "HardBounce", MessageID: "pm-1", Email: "John@Example.com", BouncedAt: "2026-09-28T12:05:00Z", Description: "Mailbox unavailable" });
    expect(db.emailMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "BOUNCED", statusReason: "Bounced: Mailbox unavailable" }) })
    );
    expect(db.emailSuppression.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ email: "john@example.com", scope: "ALL" }) }));
  });

  it("a soft bounce is noted but neither bounces nor suppresses", async () => {
    await processPostmarkPayload({ RecordType: "Bounce", ID: 43, Type: "SoftBounce", MessageID: "pm-1", Email: "john@example.com" });
    expect(db.emailMessage.updateMany).not.toHaveBeenCalled();
    expect(db.emailSuppression.upsert).not.toHaveBeenCalled();
  });

  it("a spam complaint stops non-essential mail only", async () => {
    await processPostmarkPayload({ RecordType: "SpamComplaint", ID: 44, MessageID: "pm-1", Email: "john@example.com" });
    expect(db.emailSuppression.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ scope: "NON_TRANSACTIONAL" }) }));
  });

  it("stores no message content from the payload", async () => {
    await processPostmarkPayload({ ...delivery, TextBody: "secret body" } as never);
    expect(JSON.stringify(db.emailEvent.create.mock.calls[0][0])).not.toContain("secret body");
  });
});
