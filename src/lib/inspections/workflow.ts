// Pure (client-safe): the Inspections workflow queues. Each inspection sits
// in exactly one queue, decided first by the inspection's own status and,
// once it's complete, by its current report's status. The transaction's
// stage plays no part: it is a separate lifecycle.

import type { InspectionStatus, ReportStatus } from "@prisma/client";

export const INSPECTION_QUEUES = [
  "today",
  "upcoming",
  "awaiting",
  "inProgress",
  "complete",
  "reportInProgress",
  "readyForReview",
  "readyToDeliver",
  "delivered",
] as const;
export type InspectionQueue = (typeof INSPECTION_QUEUES)[number];

export const QUEUE_INFO: Record<InspectionQueue, { title: string; hint: string; tone?: "warning" | "accent" }> = {
  today: { title: "Today", hint: "Scheduled for today, not started yet." },
  upcoming: { title: "Upcoming", hint: "Scheduled in the next 30 days." },
  awaiting: { title: "Awaiting inspection", hint: "The date has passed or isn't set, and it hasn't been started.", tone: "warning" },
  inProgress: { title: "In progress", hint: "Started, not marked complete." },
  complete: { title: "Inspection complete", hint: "Report not started yet.", tone: "warning" },
  reportInProgress: { title: "Report in progress", hint: "Draft or being written." },
  readyForReview: { title: "Ready for review", hint: "Waiting on a review before it can be finalized.", tone: "accent" },
  readyToDeliver: { title: "Ready to deliver", hint: "Finalized, not delivered yet.", tone: "accent" },
  delivered: { title: "Report delivered", hint: "Delivered in the last 14 days." },
};

export const DELIVERED_WINDOW_DAYS = 14;
export const UPCOMING_WINDOW_DAYS = 30;

export interface WorkflowInspection {
  status: InspectionStatus;
  scheduledAt: Date | null;
  // The current (newest) report, if one exists.
  report: { status: ReportStatus; deliveredAt: Date | null } | null;
}

// `dayStart`/`dayEnd` bound today in the business time zone.
export function inspectionQueue(i: WorkflowInspection, { now, dayStart, dayEnd }: { now: Date; dayStart: Date; dayEnd: Date }): InspectionQueue | null {
  switch (i.status) {
    case "CANCELLED":
      return null;
    case "SCHEDULED":
      if (!i.scheduledAt || i.scheduledAt < dayStart) return "awaiting";
      return i.scheduledAt < dayEnd ? "today" : "upcoming";
    case "IN_PROGRESS":
      return "inProgress";
    case "COMPLETED":
      switch (i.report?.status) {
        case undefined:
          return "complete";
        case "DRAFT":
        case "IN_PROGRESS":
          return "reportInProgress";
        case "REVIEW_REQUIRED":
        case "READY_FOR_REVIEW":
          return "readyForReview";
        case "FINALIZED":
        case "AMENDED":
          return "readyToDeliver";
        case "DELIVERED": {
          const since = now.getTime() - DELIVERED_WINDOW_DAYS * 24 * 60 * 60 * 1000;
          return i.report.deliveredAt && i.report.deliveredAt.getTime() >= since ? "delivered" : null;
        }
        case "ARCHIVED":
          return null;
      }
  }
}

export function groupInspectionQueues<T extends WorkflowInspection>(rows: T[], bounds: { now: Date; dayStart: Date; dayEnd: Date }): Record<InspectionQueue, T[]> {
  const groups = Object.fromEntries(INSPECTION_QUEUES.map((q) => [q, [] as T[]])) as Record<InspectionQueue, T[]>;
  for (const row of rows) {
    const queue = inspectionQueue(row, bounds);
    if (queue) groups[queue].push(row);
  }
  return groups;
}
