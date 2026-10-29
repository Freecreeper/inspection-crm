import type { EmailStatus } from "@prisma/client";

const LABELS: Record<EmailStatus, string> = {
  DRAFT: "Draft — needs review",
  SCHEDULED: "Scheduled",
  QUEUED: "Queued",
  SENDING: "Sending",
  SENT: "Sent",
  DELIVERED: "Delivered",
  FAILED: "Failed",
  BOUNCED: "Bounced",
  CANCELLED: "Cancelled",
  SUPPRESSED: "Suppressed",
  SKIPPED: "Skipped",
};

const TONE: Record<EmailStatus, string> = {
  DRAFT: "bg-info",
  SCHEDULED: "bg-neutral-400",
  QUEUED: "bg-neutral-400",
  SENDING: "bg-neutral-400",
  SENT: "bg-info",
  DELIVERED: "bg-success",
  FAILED: "bg-danger",
  BOUNCED: "bg-danger",
  CANCELLED: "bg-neutral-300",
  SUPPRESSED: "bg-warning",
  SKIPPED: "bg-warning",
};

// Status in words (the dot is decoration). A simulated send is always
// labeled as such, so nobody mistakes a dev "Sent" for a real delivery.
export function EmailStatusBadge({ status, simulated = false }: { status: EmailStatus; simulated?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-neutral-700">
      <span className={`h-1.5 w-1.5 rounded-full ${TONE[status]}`} aria-hidden="true" />
      {LABELS[status]}
      {simulated && (status === "SENT" || status === "DELIVERED") && (
        <span className="rounded bg-warning-soft px-1 text-[11px] font-medium text-warning-strong">simulated — not delivered</span>
      )}
    </span>
  );
}

export function emailStatusLabel(status: EmailStatus): string {
  return LABELS[status];
}

export const CATEGORY_LABELS = { TRANSACTIONAL: "Operational", RELATIONSHIP: "Relationship", MARKETING: "Marketing" } as const;
export const MODE_LABELS = { AUTOMATIC: "Automatic", REVIEW: "Review before send", MANUAL: "Manual" } as const;
