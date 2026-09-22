import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, ReportStatus } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

// A finalized or delivered report is frozen — "Do not allow a finalized
// report to be silently changed" (§ "Report Finalization"). AMENDED means
// "reopened for a correction, editing in progress again" here, not "already
// amended and done" — amendReport puts a report into this state, and it
// stays editable until the next finalize creates version N+1.
const EDITABLE_STATUSES: ReportStatus[] = ["DRAFT", "IN_PROGRESS", "REVIEW_REQUIRED", "READY_FOR_REVIEW", "AMENDED"];

export function isReportEditable(status: ReportStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

// Shape of ReportVersion.snapshot (a Json column, so Prisma can't type it for
// us) — the finalized-at-this-moment copy of everything the PDF and the
// customer-facing delivery view need, independent of what the live records
// go on to say later (§ "Transaction Data → Inspection Report": "Where a
// finalized report requires historical accuracy, evaluate snapshotting the
// relevant displayed information at finalization").
export interface ReportSnapshot {
  reportNumber: string;
  title: string | null;
  introduction: string | null;
  scope: string | null;
  limitations: string | null;
  footer: string | null;
  customerFacingNotes: string | null;
  property: {
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    zip: string;
    yearBuilt: number | null;
    squareFootage: number | null;
  };
  inspectorName: string | null;
  customerName: string | null;
  inspectionDate: string | Date | null;
  finalizedAt: string;
  versionNumber: number;
  reasonForRevision: string | null;
  sections: {
    name: string;
    notApplicable: boolean;
    components: {
      name: string;
      inspectionStatus: string;
      limitationNote: string | null;
      notes: string | null;
      findings: {
        id: string;
        title: string;
        description: string;
        location: string | null;
        category: string | null;
        recommendation: string | null;
        safetyRelated: boolean;
        repairRecommended: boolean;
        monitor: boolean;
        furtherEvaluation: boolean;
      }[];
    }[];
  }[];
  summary: { groupLabel: string; findingId: string }[];
}

// RPT-<year>-<8 hex chars> — human-scannable, collision-safe enough for a
// unique constraint to catch the astronomically rare clash.
export function generateReportNumber(): string {
  const year = new Date().getFullYear();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `RPT-${year}-${suffix}`;
}

// Deterministic workflow automation, not AI diagnosis (§ "Automatic Summary
// Generation"): a Finding lands in the summary only because the inspector
// explicitly set includedInSummary = true and picked its category — this
// function just mirrors that choice into ReportSummaryItem, grouped by the
// category the inspector already chose. Re-running it is idempotent: it
// reconciles the summary to match current Finding state exactly (adds rows
// for newly-included findings, removes rows for findings no longer included
// or deleted, and does not touch anything else).
export async function syncReportSummary(tx: Tx, reportId: string): Promise<void> {
  const [findings, existing] = await Promise.all([
    tx.finding.findMany({
      where: { includedInSummary: true, component: { section: { reportId } } },
      include: { category: true },
      orderBy: { displayOrder: "asc" },
    }),
    tx.reportSummaryItem.findMany({ where: { reportId } }),
  ]);

  const findingIds = new Set(findings.map((f) => f.id));
  const staleItemIds = existing.filter((item) => !findingIds.has(item.findingId)).map((item) => item.id);
  if (staleItemIds.length > 0) {
    await tx.reportSummaryItem.deleteMany({ where: { id: { in: staleItemIds } } });
  }

  const existingByFindingId = new Map(existing.map((item) => [item.findingId, item]));
  for (const [index, finding] of findings.entries()) {
    const groupLabel = finding.category?.label ?? "Other";
    const current = existingByFindingId.get(finding.id);
    if (current) {
      if (current.groupLabel !== groupLabel || current.displayOrder !== index) {
        await tx.reportSummaryItem.update({
          where: { id: current.id },
          data: { groupLabel, displayOrder: index },
        });
      }
    } else {
      await tx.reportSummaryItem.create({
        data: { reportId, findingId: finding.id, groupLabel, displayOrder: index },
      });
    }
  }
}
