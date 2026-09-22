import { describe, expect, it } from "vitest";
import { validateEmailReportToCustomer, validateFinalizeReport } from "./validation";

describe("validateEmailReportToCustomer", () => {
  it("blocks when the customer has no email", () => {
    const result = validateEmailReportToCustomer({ customerEmail: null });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ severity: "blocker" });
  });

  it("allows when the customer has an email", () => {
    const result = validateEmailReportToCustomer({ customerEmail: "buyer@example.com" });
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

describe("validateFinalizeReport", () => {
  const complete = {
    sectionsTotal: 5,
    sectionsCompleted: 5,
    componentsNotInspectedWithoutReason: 0,
    findingsMissingRecommendation: 0,
    photosMissingCaptions: 0,
    customerEmail: "buyer@example.com",
    realtorAssigned: true,
    squareFootageKnown: true,
  };

  it("is ok with no issues when everything is complete", () => {
    const result = validateFinalizeReport(complete);
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("blocks on a component left not-inspected without an explanation", () => {
    const result = validateFinalizeReport({ ...complete, componentsNotInspectedWithoutReason: 2 });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === "components" && i.severity === "blocker")).toBe(true);
  });

  it("only warns, never blocks, on missing business-context fields", () => {
    const result = validateFinalizeReport({
      ...complete,
      customerEmail: null,
      realtorAssigned: false,
      squareFootageKnown: false,
      sectionsCompleted: 3,
      findingsMissingRecommendation: 1,
      photosMissingCaptions: 2,
    });
    expect(result.ok).toBe(true);
    expect(result.issues.every((i) => i.severity === "warning")).toBe(true);
    expect(result.issues.length).toBeGreaterThanOrEqual(5);
  });
});
