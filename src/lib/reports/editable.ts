import type { Prisma, ReportStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isReportEditable } from "@/lib/reportEngine";

// The server-side half of "a finalized report can't be edited". The UI
// disables the inputs, but server actions can be called directly, so every
// report-content action runs its write through here: it resolves the report
// that owns whatever is being changed, locks that report's row (so a
// finalize running at the same moment waits instead of racing), and refuses
// unless the report is still editable.

export type ReportTarget =
  | { reportId: string }
  | { sectionId: string }
  | { componentId: string }
  | { findingId: string }
  | { mediaId: string };

export class ReportLockedError extends Error {
  constructor() {
    super("This report is not open for editing.");
    this.name = "ReportLockedError";
  }
}

export interface EditableReport {
  reportId: string;
  inspectionId: string;
}

type Tx = Prisma.TransactionClient;

async function resolveReportId(tx: Tx, target: ReportTarget): Promise<string | null> {
  if ("reportId" in target) return target.reportId;
  if ("sectionId" in target) return (await tx.reportSection.findUnique({ where: { id: target.sectionId }, select: { reportId: true } }))?.reportId ?? null;
  if ("componentId" in target) {
    return (await tx.reportComponent.findUnique({ where: { id: target.componentId }, select: { section: { select: { reportId: true } } } }))?.section.reportId ?? null;
  }
  if ("findingId" in target) {
    return (await tx.finding.findUnique({ where: { id: target.findingId }, select: { component: { select: { section: { select: { reportId: true } } } } } }))?.component.section.reportId ?? null;
  }
  const media = await tx.media.findUnique({
    where: { id: target.mediaId },
    select: { reportId: true, finding: { select: { component: { select: { section: { select: { reportId: true } } } } } } },
  });
  return media?.reportId ?? media?.finding?.component.section.reportId ?? null;
}

// Runs `write` inside a transaction holding the report's row lock. Returns
// null when the target no longer exists (e.g. a second tap on Delete), so
// callers can treat repeats as harmless.
export async function withEditableReport<T>(target: ReportTarget, write: (tx: Tx, report: EditableReport) => Promise<T>): Promise<{ report: EditableReport; result: T } | null> {
  return prisma.$transaction(async (tx) => {
    const reportId = await resolveReportId(tx, target);
    if (!reportId) return null;
    const rows = await tx.$queryRaw<{ status: ReportStatus; inspectionId: string }[]>`
      SELECT "status", "inspectionId" FROM "inspection_reports" WHERE "id" = ${reportId} FOR UPDATE`;
    const row = rows[0];
    if (!row) return null;
    if (!isReportEditable(row.status)) throw new ReportLockedError();
    const report = { reportId, inspectionId: row.inspectionId };
    return { report, result: await write(tx, report) };
  });
}
