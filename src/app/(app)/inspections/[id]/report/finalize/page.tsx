import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPrimaryCustomer } from "@/lib/transactions";
import { validateFinalizeReport } from "@/lib/validation";
import { isReportEditable } from "@/lib/reportEngine";
import { finalizeReport } from "../../../report-actions";

export default async function FinalizeReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inspection = await prisma.inspection.findUnique({
    where: { id },
    include: {
      property: true,
      transaction: { include: { customers: { include: { customer: true } }, realtors: true } },
      reports: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          sections: { include: { components: { include: { findings: true } } } },
          versions: true,
        },
      },
    },
  });
  if (!inspection) notFound();
  const report = inspection.reports[0];
  if (!report) notFound();

  const media = await prisma.media.findMany({
    where: { OR: [{ reportId: report.id }, { finding: { component: { section: { reportId: report.id } } } }] },
  });

  const allComponents = report.sections.flatMap((s) => s.components);
  const allFindings = allComponents.flatMap((c) => c.findings);
  const primaryCustomer = getPrimaryCustomer(inspection.transaction.customers);

  const readiness = validateFinalizeReport({
    sectionsTotal: report.sections.length,
    sectionsCompleted: report.sections.filter(
      (s) => s.notApplicable || s.components.every((c) => c.inspectionStatus !== "NOT_INSPECTED")
    ).length,
    componentsNotInspectedWithoutReason: allComponents.filter(
      (c) => ["NOT_INSPECTED", "NOT_ACCESSIBLE", "LIMITED_INSPECTION"].includes(c.inspectionStatus) && !c.limitationNote
    ).length,
    findingsMissingRecommendation: allFindings.filter((f) => !f.recommendation).length,
    photosMissingCaptions: media.filter((m) => !m.caption).length,
    customerEmail: primaryCustomer?.email,
    realtorAssigned: inspection.transaction.realtors.length > 0,
    squareFootageKnown: Boolean(inspection.property.squareFootage),
  });

  const editable = isReportEditable(report.status);
  const finalizeAction = finalizeReport.bind(null, report.id);

  return (
    <div className="max-w-2xl space-y-6">
      <Link href={`/inspections/${id}/report`} className="text-xs text-slate-500 hover:underline">
        ← Back to report
      </Link>
      <h1 className="text-xl font-semibold text-slate-900">Validate &amp; finalize</h1>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          {readiness.ok ? "Ready to finalize" : "Cannot finalize yet"}
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          {readiness.issues.map((issue, idx) => (
            <li key={idx} className={`flex items-start gap-2 ${issue.severity === "blocker" ? "text-red-700" : "text-amber-700"}`}>
              <span className="mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase" style={{ backgroundColor: issue.severity === "blocker" ? "#fee2e2" : "#fef3c7" }}>
                {issue.severity}
              </span>
              {issue.message}
            </li>
          ))}
          {readiness.issues.length === 0 && <li className="text-emerald-700">No warnings — everything looks complete.</li>}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Only blockers prevent finalization. Warnings are the authorized inspector&apos;s call — accept them and finalize
          anyway if the report is otherwise ready.
        </p>
      </section>

      {editable && readiness.ok && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <form action={finalizeAction} className="space-y-2">
            {report.versions.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-slate-600">Reason for revision</label>
                <input name="reasonForRevision" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder="What changed since the last version?" />
              </div>
            )}
            <button type="submit" className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
              {report.versions.length > 0 ? `Finalize version ${report.versions.length + 1}` : "Finalize report"}
            </button>
          </form>
        </section>
      )}

      {!editable && (
        <p className="text-sm text-slate-500">
          This report is {report.status.toLowerCase()}. See <Link href={`/inspections/${id}/report/versions`} className="text-blue-700 hover:underline">versions</Link> to amend it.
        </p>
      )}
    </div>
  );
}
