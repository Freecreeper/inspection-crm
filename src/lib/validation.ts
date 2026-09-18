// The non-blocking readiness pattern from §7: every state-transition action is
// validated against *that specific action*, never against a blanket "required
// fields" form. A warning never stops anything; only an explicit blocker does.

export type Severity = "warning" | "blocker";

export interface ReadinessIssue {
  field: string;
  message: string;
  severity: Severity;
}

export interface ReadinessResult {
  ok: boolean; // true iff there are no blockers — warnings never flip this to false
  issues: ReadinessIssue[];
}

function evaluate(issues: ReadinessIssue[]): ReadinessResult {
  return { ok: !issues.some((i) => i.severity === "blocker"), issues };
}

// Example: emailing a report to the customer requires an email address on file.
// Every other action on that report (finalize, add findings, upload photos)
// stays available regardless — this check only ever gates this one action.
export function validateEmailReportToCustomer(input: {
  customerEmail: string | null | undefined;
}): ReadinessResult {
  const issues: ReadinessIssue[] = [];
  if (!input.customerEmail) {
    issues.push({
      field: "customer.email",
      message: "Customer email address unavailable — cannot email the report.",
      severity: "blocker",
    });
  }
  return evaluate(issues);
}

// Example: finalizing a report. Missing optional business context surfaces as
// warnings the inspector can consciously accept; only unresolved
// safety-relevant findings without a recommendation actually block (§ "Report
// Validation" / §"Report Finalization").
export function validateFinalizeReport(input: {
  sectionsTotal: number;
  sectionsCompleted: number;
  componentsNotInspectedWithoutReason: number;
  findingsMissingRecommendation: number;
  photosMissingCaptions: number;
  customerEmail: string | null | undefined;
  realtorAssigned: boolean;
  squareFootageKnown: boolean;
}): ReadinessResult {
  const issues: ReadinessIssue[] = [];

  if (input.componentsNotInspectedWithoutReason > 0) {
    issues.push({
      field: "components",
      message: `${input.componentsNotInspectedWithoutReason} component(s) marked not-inspected without an explanation.`,
      severity: "blocker",
    });
  }
  if (input.findingsMissingRecommendation > 0) {
    issues.push({
      field: "findings",
      message: `${input.findingsMissingRecommendation} finding(s) missing a recommendation.`,
      severity: "warning",
    });
  }
  if (input.photosMissingCaptions > 0) {
    issues.push({
      field: "media",
      message: `${input.photosMissingCaptions} photo(s) missing a caption.`,
      severity: "warning",
    });
  }
  if (!input.customerEmail) {
    issues.push({ field: "customer.email", message: "Customer email not available.", severity: "warning" });
  }
  if (!input.realtorAssigned) {
    issues.push({ field: "realtor", message: "Listing realtor unknown.", severity: "warning" });
  }
  if (!input.squareFootageKnown) {
    issues.push({ field: "property.squareFootage", message: "Square footage not provided.", severity: "warning" });
  }
  if (input.sectionsCompleted < input.sectionsTotal) {
    issues.push({
      field: "sections",
      message: `${input.sectionsTotal - input.sectionsCompleted} section(s) not yet marked complete.`,
      severity: "warning",
    });
  }

  return evaluate(issues);
}
