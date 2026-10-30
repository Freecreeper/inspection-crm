import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/email/context", () => ({
  loadEmailVariables: vi.fn(async () => ({ "customer.fullName": "Gale Fixturely", "property.address": "505 Mockingbird Test Rd, Morganton, NC 28655", "company.name": "Test Inspections" })),
}));

import { prisma } from "@/lib/prisma";
import { createAgreementToken, verifyAgreementToken } from "./token";
import { agreementTextHash, DEFAULT_AGREEMENT_BODY, fillAgreement } from "./text";
import { loadForSigning, requestSignature, signAgreement } from "./service";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>> & { $executeRaw: Fn };
const NOW = new Date("2026-10-30T15:00:00Z");
const client = { ip: "203.0.113.7", userAgent: "Mozilla/5.0 Test" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-secret-that-is-long-enough-for-hmac-signing";
  db.$executeRaw.mockResolvedValue(1);
});

describe("signing links", () => {
  it("round-trip, and any tampering is refused", () => {
    const token = createAgreementToken("cmabc123def456ghi");
    expect(verifyAgreementToken(token)).toBe("cmabc123def456ghi");
    const [payload, sig] = token.split(".");
    expect(verifyAgreementToken(`${Buffer.from("cmother1234567890").toString("base64url")}.${sig}`)).toBeNull();
    expect(verifyAgreementToken(`${payload}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(verifyAgreementToken("garbage")).toBeNull();
  });

  it("stop verifying when the secret changes", () => {
    const token = createAgreementToken("cmabc123def456ghi");
    process.env.AUTH_SECRET = "a-different-secret-that-is-also-long-enough";
    expect(verifyAgreementToken(token)).toBeNull();
  });
});

describe("agreement text", () => {
  it("fills placeholders, uses fallbacks, and blanks anything left so no {{…}} reaches a signed document", () => {
    const { text, missing } = fillAgreement('For {{customer.fullName}} at {{property.address}}, fee {{inspection.fee | "as quoted"}}, on {{inspection.date}}. {{not.a.variable}}', { "customer.fullName": "Gale", "property.address": "505 Test Rd" });
    expect(text).toBe("For Gale at 505 Test Rd, fee as quoted, on ________. ________");
    expect(missing).toEqual(["inspection.date", "not.a.variable"]);
  });

  it("the placeholder wording says it's a placeholder, and covers electronic signature consent", () => {
    expect(DEFAULT_AGREEMENT_BODY.startsWith("PLACEHOLDER WORDING")).toBe(true);
    expect(DEFAULT_AGREEMENT_BODY).toMatch(/electronic signature is the legal equivalent/);
  });

  it("fingerprints exactly what was shown", () => {
    expect(agreementTextHash("T", "body")).toHaveLength(64);
    expect(agreementTextHash("T", "body")).not.toBe(agreementTextHash("T", "body."));
  });
});

describe("requestSignature", () => {
  const inspection = (over: Record<string, unknown> = {}) => ({
    id: "i1",
    status: "SCHEDULED",
    transactionId: "t1",
    agreementSignedAt: null,
    transaction: {
      customers: [
        { customerId: "c2", primaryContact: false, customer: { id: "c2", firstName: "Dana", lastName: "Testbuyer", email: "dana@example.com" } },
        { customerId: "c1", primaryContact: true, customer: { id: "c1", firstName: "Gale", lastName: "Fixturely", email: "gale@example.com" } },
      ],
    },
    ...over,
  });

  beforeEach(() => {
    db.agreementSettings.findUnique.mockResolvedValue(null);
    db.inspectionAgreement.updateMany.mockResolvedValue({ count: 1 });
    db.inspectionAgreement.create.mockResolvedValue({ id: "agr1" });
  });

  it("freezes the filled-in text for the primary customer and replaces any open request", async () => {
    db.inspection.findUnique.mockResolvedValue(inspection());
    const result = await requestSignature("u1", "i1");
    expect(result).toMatchObject({ ok: true, data: { id: "agr1", url: expect.stringMatching(/\/a\/.+\..+/) } });
    expect(db.inspectionAgreement.updateMany).toHaveBeenCalledWith({ where: { inspectionId: "i1", status: "PENDING" }, data: { status: "REVOKED", revokedAt: expect.any(Date) } });
    const data = db.inspectionAgreement.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ inspectionId: "i1", customerId: "c1", signerName: "Gale Fixturely", signerEmail: "gale@example.com", title: "Pre-Inspection Agreement" });
    expect(data.body).toContain("Gale Fixturely");
    expect(data.body).toContain("505 Mockingbird Test Rd");
    expect(data.body).not.toMatch(/\{\{/);
    expect(data.textHash).toBe(agreementTextHash(data.title, data.body));
  });

  it("can be for another customer on the deal, but not someone off it, and not for a cancelled inspection", async () => {
    db.inspection.findUnique.mockResolvedValue(inspection());
    await requestSignature("u1", "i1", "c2");
    expect(db.inspectionAgreement.create.mock.calls[0][0].data).toMatchObject({ customerId: "c2", signerName: "Dana Testbuyer" });
    expect(await requestSignature("u1", "i1", "stranger")).toMatchObject({ ok: false });
    db.inspection.findUnique.mockResolvedValue(inspection({ status: "CANCELLED" }));
    expect(await requestSignature("u1", "i1")).toMatchObject({ ok: false });
  });
});

describe("signing", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "cmagr1234567890", status: "PENDING", expiresAt: new Date("2026-11-29T15:00:00Z"), inspectionId: "i1", customerId: "c1", signerName: "Gale Fixturely", ...over });
  const token = () => createAgreementToken("cmagr1234567890");

  beforeEach(() => {
    db.inspectionAgreement.findUnique.mockResolvedValue(row());
    db.inspectionAgreement.updateMany.mockResolvedValue({ count: 1 });
    db.inspection.updateMany.mockResolvedValue({ count: 1 });
    db.inspection.findUnique.mockResolvedValue({ transactionId: "t1" });
  });

  it("records who, when, from where, and marks the inspection's agreement signed", async () => {
    expect(await signAgreement(token(), { name: "  Gale   Fixturely ", agreed: true }, client, NOW)).toEqual({ ok: true, data: undefined });
    expect(db.inspectionAgreement.updateMany).toHaveBeenCalledWith({
      where: { id: "cmagr1234567890", status: "PENDING" },
      data: { status: "SIGNED", signedAt: NOW, signedName: "Gale Fixturely", signedIp: "203.0.113.7", signedUserAgent: "Mozilla/5.0 Test" },
    });
    expect(db.inspection.updateMany).toHaveBeenCalledWith({ where: { id: "i1", agreementSignedAt: null }, data: { agreementSignedAt: NOW } });
    expect(db.communication.create).toHaveBeenCalledWith({ data: expect.objectContaining({ inspectionId: "i1", transactionId: "t1", customerId: "c1", summary: "Inspection agreement signed online by Gale Fixturely." }) });
  });

  it("needs the box ticked and a typed name", async () => {
    expect(await signAgreement(token(), { name: "Gale", agreed: false }, client, NOW)).toMatchObject({ ok: false });
    expect(await signAgreement(token(), { name: " ", agreed: true }, client, NOW)).toMatchObject({ ok: false });
    expect(db.inspectionAgreement.updateMany).not.toHaveBeenCalled();
  });

  it("won't sign an expired, cancelled or forged link", async () => {
    db.inspectionAgreement.findUnique.mockResolvedValueOnce(row({ expiresAt: new Date("2026-10-30T14:00:00Z") }));
    expect(await signAgreement(token(), { name: "Gale", agreed: true }, client, NOW)).toMatchObject({ ok: false, error: expect.stringContaining("expired") });
    db.inspectionAgreement.findUnique.mockResolvedValueOnce(row({ status: "REVOKED" }));
    expect(await signAgreement(token(), { name: "Gale", agreed: true }, client, NOW)).toMatchObject({ ok: false, error: expect.stringContaining("cancelled") });
    expect(await signAgreement("forged.token", { name: "Gale", agreed: true }, client, NOW)).toMatchObject({ ok: false });
    expect(db.inspectionAgreement.updateMany).not.toHaveBeenCalled();
  });

  it("signs once: a second press changes nothing", async () => {
    db.inspectionAgreement.updateMany.mockResolvedValue({ count: 0 });
    expect(await signAgreement(token(), { name: "Gale", agreed: true }, client, NOW)).toEqual({ ok: true, data: undefined });
    expect(db.inspection.updateMany).not.toHaveBeenCalled();
    expect(db.communication.create).not.toHaveBeenCalled();
  });

  it("the page shows the right state for each link", async () => {
    expect(await loadForSigning(token(), NOW)).toMatchObject({ state: "open" });
    db.inspectionAgreement.findUnique.mockResolvedValueOnce({ ...row({ status: "SIGNED" }), title: "T", body: "B", textHash: "h", signedAt: NOW, signedName: "Gale" });
    expect(await loadForSigning(token(), NOW)).toMatchObject({ state: "signed", signedName: "Gale" });
    db.inspectionAgreement.findUnique.mockResolvedValueOnce(row({ expiresAt: new Date("2026-10-01T00:00:00Z") }));
    expect(await loadForSigning(token(), NOW)).toMatchObject({ state: "expired" });
    expect(await loadForSigning("nope", NOW)).toEqual({ state: "invalid" });
  });
});
