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
  DRAFT: "bg-sky-500",
  SCHEDULED: "bg-slate-400",
  QUEUED: "bg-slate-400",
  SENDING: "bg-slate-400",
  SENT: "bg-emerald-500",
  DELIVERED: "bg-emerald-600",
  FAILED: "bg-red-500",
  BOUNCED: "bg-red-500",
  CANCELLED: "bg-slate-300",
  SUPPRESSED: "bg-amber-500",
  SKIPPED: "bg-amber-500",
};

// Status in words (the dot is decoration). A simulated send is always
// labeled as such, so nobody mistakes a dev "Sent" for a real delivery.
export function EmailStatusBadge({ status, simulated = false }: { status: EmailStatus; simulated?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-700">
      <span className={`h-1.5 w-1.5 rounded-full ${TONE[status]}`} aria-hidden="true" />
      {LABELS[status]}
      {simulated && (status === "SENT" || status === "DELIVERED") && (
        <span className="rounded bg-amber-50 px-1 text-[11px] font-medium text-amber-800">simulated — not delivered</span>
      )}
    </span>
  );
}

export function emailStatusLabel(status: EmailStatus): string {
  return LABELS[status];
}

export const CATEGORY_LABELS = { TRANSACTIONAL: "Operational", RELATIONSHIP: "Relationship", MARKETING: "Marketing" } as const;
export const MODE_LABELS = { AUTOMATIC: "Automatic", REVIEW: "Review before send", MANUAL: "Manual" } as const;
