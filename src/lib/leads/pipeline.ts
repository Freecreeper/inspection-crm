// Pure (client-safe): the Leads workflow. Stages are the lead's own status;
// nothing here is inferred from other records. Converting goes through
// convertLead (it creates the customer and transaction), so "Converted" is
// never a stage anyone can move a lead into by hand.

import type { LeadStatus } from "@prisma/client";

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  CONVERTED: "Converted",
  LOST: "Lost",
};

// Statuses staff may set directly (setLeadStatus).
export const SETTABLE_LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "LOST"] as const satisfies readonly LeadStatus[];
export type SettableLeadStatus = (typeof SETTABLE_LEAD_STATUSES)[number];

export function isSettableLeadStatus(value: unknown): value is SettableLeadStatus {
  return typeof value === "string" && (SETTABLE_LEAD_STATUSES as readonly string[]).includes(value);
}

// The next steps offered on a lead in each stage — only the ones that make
// sense from where it is.
export function leadMoves(status: LeadStatus): SettableLeadStatus[] {
  switch (status) {
    case "NEW":
      return ["CONTACTED", "LOST"];
    case "CONTACTED":
      return ["QUALIFIED", "LOST"];
    case "QUALIFIED":
      return ["LOST"];
    case "LOST":
      return ["NEW"];
    case "CONVERTED":
      return [];
  }
}

export const LEAD_MOVE_LABELS: Record<SettableLeadStatus, string> = {
  NEW: "Reopen",
  CONTACTED: "Mark contacted",
  QUALIFIED: "Mark qualified",
  LOST: "Mark lost",
};

export const OPEN_LEAD_STAGES = ["NEW", "CONTACTED", "QUALIFIED"] as const satisfies readonly LeadStatus[];
// Closed leads stay in the pipeline this long, then live only in Records.
export const CLOSED_LEAD_WINDOW_DAYS = 30;

export interface PipelineLead {
  id: string;
  status: LeadStatus;
  updatedAt: Date;
}

export function groupPipeline<T extends PipelineLead>(leads: T[], now: Date): Record<LeadStatus, T[]> {
  const since = now.getTime() - CLOSED_LEAD_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const groups: Record<LeadStatus, T[]> = { NEW: [], CONTACTED: [], QUALIFIED: [], CONVERTED: [], LOST: [] };
  for (const lead of leads) {
    const closed = lead.status === "CONVERTED" || lead.status === "LOST";
    if (closed && lead.updatedAt.getTime() < since) continue;
    groups[lead.status].push(lead);
  }
  return groups;
}
