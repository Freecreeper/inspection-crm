// Pure. What could stop an upcoming inspection from going smoothly — and
// nothing else. A missing secondary phone or brokerage website is a
// data-quality question for the record, not a Calendar warning.

import type { CalendarWarning } from "./types";

export interface ReadinessInput {
  status: string;
  inspectorId: string | null;
  agreementSignedAt: Date | null;
  serviceCount: number;
  // The customer who'd be called about access or a delay (primary, else first).
  customer: { phone: string | null; email: string | null } | null;
  // Only evaluated when the business requires payment before inspection.
  balanceDue: boolean | null;
  requirePaymentBeforeInspection: boolean;
}

// Warnings for an inspection still ahead (or under way). Finished or
// cancelled inspections have nothing to warn about.
export function readinessWarnings(input: ReadinessInput): CalendarWarning[] {
  if (input.status !== "SCHEDULED" && input.status !== "IN_PROGRESS") return [];
  const warnings: CalendarWarning[] = [];
  if (!input.inspectorId) warnings.push({ code: "noInspector", label: "No inspector assigned" });
  if (input.status === "SCHEDULED" && !input.agreementSignedAt) warnings.push({ code: "agreementUnsigned", label: "Agreement unsigned" });
  if (!input.customer || (!input.customer.phone && !input.customer.email)) warnings.push({ code: "noCustomerContact", label: "No way to reach the customer" });
  if (input.serviceCount === 0) warnings.push({ code: "noServices", label: "No services selected" });
  if (input.requirePaymentBeforeInspection && input.balanceDue) warnings.push({ code: "paymentDue", label: "Payment due before inspection" });
  return warnings;
}

export type ChecklistState = "done" | "warn" | "pending" | "na";

export interface ChecklistItem {
  key: "agreement" | "payment" | "confirmation" | "inspection" | "report";
  label: string;
  state: ChecklistState;
  detail?: string;
}

export interface ChecklistInput {
  status: string;
  agreementSignedAt: Date | null;
  // null = nothing invoiced yet.
  payment: { invoiced: boolean; balanceDue: boolean } | null;
  requirePaymentBeforeInspection: boolean;
  // Status of the confirmation email, if one exists.
  confirmation: "sent" | "queued" | "review" | "skipped" | "none";
  report: { status: string; delivered: boolean } | null;
}

// The preview drawer's readiness list: facts from the record, with "not
// yet" shown as pending rather than invented as done.
export function readinessChecklist(input: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  items.push(
    input.agreementSignedAt
      ? { key: "agreement", label: "Agreement signed", state: "done" }
      : { key: "agreement", label: "Agreement unsigned", state: input.status === "SCHEDULED" ? "warn" : "pending" }
  );

  if (!input.payment || !input.payment.invoiced) {
    items.push({ key: "payment", label: "Not invoiced yet", state: input.requirePaymentBeforeInspection ? "warn" : "pending" });
  } else if (input.payment.balanceDue) {
    items.push({ key: "payment", label: "Balance due", state: input.requirePaymentBeforeInspection ? "warn" : "pending" });
  } else {
    items.push({ key: "payment", label: "Payment received", state: "done" });
  }

  const confirmation: Record<ChecklistInput["confirmation"], ChecklistItem> = {
    sent: { key: "confirmation", label: "Confirmation sent", state: "done" },
    queued: { key: "confirmation", label: "Confirmation queued", state: "pending" },
    review: { key: "confirmation", label: "Confirmation waiting for review", state: "pending" },
    skipped: { key: "confirmation", label: "Confirmation not sent", state: "warn", detail: "See the Emails section on the inspection" },
    none: { key: "confirmation", label: "No confirmation email", state: "na" },
  };
  items.push(confirmation[input.confirmation]);

  const inspectionState: Record<string, ChecklistItem> = {
    SCHEDULED: { key: "inspection", label: "Inspection", state: "pending" },
    IN_PROGRESS: { key: "inspection", label: "Inspection in progress", state: "pending" },
    COMPLETED: { key: "inspection", label: "Inspection completed", state: "done" },
    CANCELLED: { key: "inspection", label: "Inspection cancelled", state: "na" },
  };
  items.push(inspectionState[input.status] ?? { key: "inspection", label: "Inspection", state: "pending" });

  if (!input.report) items.push({ key: "report", label: "Report not started", state: "pending" });
  else if (input.report.delivered) items.push({ key: "report", label: "Report delivered", state: "done" });
  else items.push({ key: "report", label: `Report ${input.report.status.toLowerCase().replace(/_/g, " ")}`, state: "pending" });
  return items;
}
