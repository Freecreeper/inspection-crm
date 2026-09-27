import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/realtors/directory", () => ({ realtorIdsWithActivitySince: vi.fn(async () => ["r1", "r2", "r3", "r4", "r5", "r6"]) }));

import { prisma } from "@/lib/prisma";
import { primeEmailDb, type MockDb } from "@/test-utils/emailFixtures";
import { materializeCampaign, parseAudience, previewAudience } from "./campaigns";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";
import { applyUnsubscribe } from "./preferences";

const db = prisma as unknown as MockDb;
let rows: Map<string, Record<string, unknown>>;

const prefs = { archivedAt: null, relationshipEmailsEnabled: true, marketingOptIn: true, marketingUnsubscribedAt: null, preferredName: null, brokerage: { name: "KW" } };
const realtors = [
  { id: "r1", firstName: "Ann", lastName: "A", email: "ann@x.test", ...prefs },
  { id: "r2", firstName: "Ben", lastName: "B", email: "ben@x.test", ...prefs, marketingUnsubscribedAt: new Date() },
  { id: "r3", firstName: "Cal", lastName: "C", email: null, ...prefs },
  { id: "r4", firstName: "Dee", lastName: "D", email: "dee@x.test", ...prefs },
  { id: "r5", firstName: "Eve", lastName: "E", email: "ANN@x.test", ...prefs },
  { id: "r6", firstName: "Fay", lastName: "F", email: "fay@x.test", ...prefs, marketingOptIn: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-only-secret");
  rows = primeEmailDb(db);
  db.realtor.findMany.mockResolvedValue(realtors);
  const suppressions = [{ email: "dee@x.test", scope: "ALL" }];
  db.emailSuppression.findMany.mockImplementation(async ({ where }: { where: { email: string | { in: string[] } } }) =>
    suppressions.filter((row) => (typeof where.email === "string" ? row.email === where.email : where.email.in.includes(row.email)))
  );
  db.realtor.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => realtors.find((r) => r.id === where.id) ?? null);
});

describe("campaign audience preview", () => {
  it("reports exactly who is eligible, who is excluded, and why", async () => {
    const preview = await previewAudience(parseAudience({ activeWithinMonths: 12 }), "MARKETING");
    expect(preview.eligible.map((m) => m.realtorId)).toEqual(["r1"]);
    expect(Object.fromEntries(preview.excluded.map((m) => [m.realtorId, m.reason]))).toEqual({
      r2: "Unsubscribed from marketing email",
      r3: "Realtor email not provided",
      r4: "Address is suppressed (bounced or deactivated)",
      r5: "Duplicate email address in audience",
      r6: "Not opted in to marketing email",
    });
    expect(preview.reasons.reduce((n, r) => n + r.count, 0)).toBe(5);
  });

  it("builds the audience from deterministic rules only", async () => {
    await previewAudience(parseAudience({ brokerageIds: ["b1"], cities: ["Hickory"] }), "MARKETING");
    expect(db.realtor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null, brokerageId: { in: ["b1"] }, brokerage: { city: { in: ["Hickory"], mode: "insensitive" } } } })
    );
  });
});

describe("materializeCampaign", () => {
  const campaign = {
    id: "camp-1",
    category: "MARKETING",
    templateId: "tpl-new_service_announcement",
    subject: "Now offering sewer scopes",
    body: "Hi {{realtor.firstName}}, we now offer sewer scope inspections.",
    audience: {},
    approvedById: "owner-1",
  };

  it("creates one record per realtor, sends only to the eligible, and never twice", async () => {
    await materializeCampaign(campaign as never);
    await materializeCampaign(campaign as never);

    const all = [...rows.values()];
    expect(all).toHaveLength(realtors.length);
    expect(all.filter((m) => m.status === "QUEUED").map((m) => m.realtorId)).toEqual(["r1"]);
    expect(all.find((m) => m.realtorId === "r5")).toMatchObject({ status: "SKIPPED", statusReason: "Duplicate email address in audience" });
    expect(all.find((m) => m.realtorId === "r2")).toMatchObject({ status: "SKIPPED", statusReason: "Unsubscribed from marketing email" });
    expect(all.every((m) => m.campaignId === "camp-1" && String(m.idempotencyKey).startsWith("campaign:camp-1:realtor:"))).toBe(true);
    expect(all.find((m) => m.realtorId === "r1")?.bodyText).toBe("Hi Ann, we now offer sewer scope inspections.");
  });
});

describe("unsubscribe tokens", () => {
  it("round-trip and are scoped to one realtor and one category", () => {
    const token = createUnsubscribeToken("r1", "marketing");
    expect(verifyUnsubscribeToken(token)).toEqual({ realtorId: "r1", scope: "marketing" });
  });

  it("unsubscribing is scoped, audited, and a repeated one-click is a no-op", async () => {
    db.realtor.findUnique.mockResolvedValueOnce({ id: "r1", marketingOptIn: true, marketingUnsubscribedAt: null, relationshipEmailsEnabled: true });
    expect(await applyUnsubscribe("r1", "marketing", "one-click unsubscribe")).toBe(true);
    expect(db.realtor.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { marketingUnsubscribedAt: expect.any(Date), marketingOptIn: false } });
    expect(db.activityLog.create).toHaveBeenCalledTimes(1);

    db.realtor.findUnique.mockResolvedValueOnce({ id: "r1", marketingOptIn: false, marketingUnsubscribedAt: new Date(), relationshipEmailsEnabled: true });
    expect(await applyUnsubscribe("r1", "marketing", "one-click unsubscribe")).toBe(true);
    expect(db.realtor.update).toHaveBeenCalledTimes(1);
    expect(db.activityLog.create).toHaveBeenCalledTimes(1);
  });

  it("reject tampering", () => {
    const [payload, sig] = createUnsubscribeToken("r1", "marketing").split(".");
    const forged = Buffer.from("r2:marketing").toString("base64url");
    expect(verifyUnsubscribeToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${payload}.x${sig.slice(1)}`)).toBeNull();
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
  });
});
