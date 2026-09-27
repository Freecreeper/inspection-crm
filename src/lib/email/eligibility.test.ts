import { describe, it, expect } from "vitest";
import { evaluateEligibility, type EligibilityInput } from "./eligibility";

const realtor = { archivedAt: null, relationshipEmailsEnabled: true, marketingOptIn: true, marketingUnsubscribedAt: null };
const base = (over: Partial<EligibilityInput>): EligibilityInput => ({
  category: "TRANSACTIONAL",
  recipientType: "CUSTOMER",
  email: "john@example.com",
  realtor: null,
  suppressionScopes: [],
  marketingRequiresOptIn: true,
  ...over,
});

describe("evaluateEligibility", () => {
  it("skips (not fails) when the customer has no email", () => {
    expect(evaluateEligibility(base({ email: null }))).toEqual({ ok: false, status: "SKIPPED", reason: "Customer email not provided" });
    expect(evaluateEligibility(base({ email: "   " }))).toMatchObject({ status: "SKIPPED" });
  });

  it("skips relationship email safely when the realtor has no email", () => {
    expect(evaluateEligibility(base({ category: "RELATIONSHIP", recipientType: "REALTOR", email: null, realtor }))).toEqual({
      ok: false,
      status: "SKIPPED",
      reason: "Realtor email not provided",
    });
  });

  it("a marketing unsubscribe blocks marketing but never operational email", () => {
    const unsubscribed = { ...realtor, marketingUnsubscribedAt: new Date() };
    expect(evaluateEligibility(base({ category: "MARKETING", recipientType: "REALTOR", realtor: unsubscribed }))).toMatchObject({ status: "SUPPRESSED" });
    expect(evaluateEligibility(base({ category: "MARKETING", recipientType: "REALTOR", suppressionScopes: ["MARKETING"], realtor }))).toMatchObject({
      status: "SUPPRESSED",
    });
    expect(evaluateEligibility(base({ category: "TRANSACTIONAL", recipientType: "REALTOR", suppressionScopes: ["MARKETING"], realtor: unsubscribed }))).toEqual({
      ok: true,
    });
  });

  it("a complaint stops relationship and marketing mail but not operational", () => {
    expect(evaluateEligibility(base({ category: "RELATIONSHIP", recipientType: "REALTOR", suppressionScopes: ["NON_TRANSACTIONAL"], realtor }))).toMatchObject({
      status: "SUPPRESSED",
    });
    expect(evaluateEligibility(base({ suppressionScopes: ["NON_TRANSACTIONAL"] }))).toEqual({ ok: true });
  });

  it("a hard bounce stops everything, operational included", () => {
    expect(evaluateEligibility(base({ suppressionScopes: ["ALL"] }))).toMatchObject({ status: "SUPPRESSED" });
  });

  it("having an email isn't marketing permission when opt-in is required", () => {
    const notOptedIn = { ...realtor, marketingOptIn: false };
    expect(evaluateEligibility(base({ category: "MARKETING", recipientType: "REALTOR", realtor: notOptedIn }))).toEqual({
      ok: false,
      status: "SKIPPED",
      reason: "Not opted in to marketing email",
    });
    expect(evaluateEligibility(base({ category: "MARKETING", recipientType: "REALTOR", realtor: notOptedIn, marketingRequiresOptIn: false }))).toEqual({ ok: true });
  });

  it("honors the realtor's relationship-email switch separately from marketing", () => {
    const off = { ...realtor, relationshipEmailsEnabled: false };
    expect(evaluateEligibility(base({ category: "RELATIONSHIP", recipientType: "REALTOR", realtor: off }))).toMatchObject({ status: "SUPPRESSED" });
    expect(evaluateEligibility(base({ category: "MARKETING", recipientType: "REALTOR", realtor: off }))).toEqual({ ok: true });
  });
});
