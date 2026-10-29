// Pure (client-safe): the transaction lifecycle as a workflow. A
// transaction's stage is its own status, moved deliberately by staff
// (setTransactionStatus); it is never derived from its inspections, whose
// status is a separate thing.

import type { TransactionStatus } from "@prisma/client";

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  LEAD_IN_PROGRESS: "Lead in progress",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const OPEN_TRANSACTION_STAGES = ["LEAD_IN_PROGRESS", "SCHEDULED", "IN_PROGRESS", "COMPLETED"] as const satisfies readonly TransactionStatus[];
const FORWARD: Partial<Record<TransactionStatus, TransactionStatus>> = {
  LEAD_IN_PROGRESS: "SCHEDULED",
  SCHEDULED: "IN_PROGRESS",
  IN_PROGRESS: "COMPLETED",
  COMPLETED: "CLOSED",
};

export interface StageMove {
  to: TransactionStatus;
  label: string;
}

// The moves offered from each stage: the next step, cancelling while
// open, and reopening a cancelled one. Closed is final.
export function transactionMoves(status: TransactionStatus): StageMove[] {
  if (status === "CANCELLED") return [{ to: "LEAD_IN_PROGRESS", label: "Reopen" }];
  if (status === "CLOSED") return [];
  const next = FORWARD[status]!;
  return [
    { to: next, label: `Move to ${TRANSACTION_STATUS_LABELS[next].toLowerCase()}` },
    { to: "CANCELLED", label: "Cancel" },
  ];
}

export function isAllowedTransactionMove(from: TransactionStatus, to: unknown): to is TransactionStatus {
  return transactionMoves(from).some((m) => m.to === to);
}

export const CLOSED_TRANSACTION_WINDOW_DAYS = 30;

export function groupTransactionStages<T extends { status: TransactionStatus; updatedAt: Date }>(rows: T[], now: Date): Record<TransactionStatus, T[]> {
  const since = now.getTime() - CLOSED_TRANSACTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const groups: Record<TransactionStatus, T[]> = { LEAD_IN_PROGRESS: [], SCHEDULED: [], IN_PROGRESS: [], COMPLETED: [], CLOSED: [], CANCELLED: [] };
  for (const row of rows) {
    const finished = row.status === "CLOSED" || row.status === "CANCELLED";
    if (finished && row.updatedAt.getTime() < since) continue;
    groups[row.status].push(row);
  }
  return groups;
}
