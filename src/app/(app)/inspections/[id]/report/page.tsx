import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isReportEditable } from "@/lib/reportEngine";
import { updateReportField } from "../../report-actions";

export default async function ReportOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inspection = await prisma.inspection.findUnique({
    where: { id },
    include: {
      reports: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          sections: {
            orderBy: { displayOrder: "asc" },
            include: { components: { include: { findings: true } } },
          },
        },
      },
    },
  });
  if (!inspection) notFound();
  const report = inspection.reports[0];
  if (!report) notFound();

  const editable = isReportEditable(report.status);
  const fieldAction = updateReportField.bind(null, report.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-wide text-slate-500">Inspection Report</p>
          <h1 className="text-xl font-semibold text-slate-900">{report.title || report.reportNumber}</h1>
          <span className="mt-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 font-mono text-[11px] text-blue-700">
            {report.status}
          </span>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href={`/inspections/${id}/report/preview`} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            Preview
          </Link>
          <Link href={`/inspections/${id}/report/finalize`} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            Validate &amp; finalize
          </Link>
          <Link href={`/inspections/${id}/report/versions`} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            Versions
          </Link>
        </nav>
      </div>

      {!editable && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This report is {report.status.toLowerCase()} and locked from editing. Use &quot;Amend&quot; from the versions
          page to reopen it.
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Report details</h2>
        <div className="mt-3 space-y-3">
          {(
            [
              ["title", "Title", report.title],
              ["introduction", "Introduction", report.introduction],
              ["scope", "Scope", report.scope],
              ["limitations", "Limitations", report.limitations],
              ["customerFacingNotes", "Customer-facing notes", report.customerFacingNotes],
              ["internalNotes", "Internal notes (staff only)", report.internalNotes],
            ] as const
          ).map(([field, label, value]) => (
            <form key={field} action={fieldAction} className="space-y-1">
              <input type="hidden" name="field" value={field} />
              <label className="block text-xs font-medium text-slate-600">{label}</label>
              <div className="flex gap-2">
                <textarea
                  name="value"
                  defaultValue={value ?? ""}
                  rows={field === "title" ? 1 : 2}
                  disabled={!editable}
                  className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                />
                {editable && (
                  <button type="submit" className="self-start rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                    Save
                  </button>
                )}
              </div>
            </form>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Sections</h2>
        <ul className="mt-2 divide-y divide-slate-100">
          {report.sections.map((section) => {
            const findingCount = section.components.reduce((sum, c) => sum + c.findings.length, 0);
            const inspectedCount = section.components.filter((c) => c.inspectionStatus !== "NOT_INSPECTED").length;
            return (
              <li key={section.id} className="flex items-center justify-between py-2">
                <Link href={`/inspections/${id}/report/sections/${section.id}`} className="text-sm font-medium text-slate-900 hover:underline">
                  {section.name}
                  {section.notApplicable && <span className="ml-2 text-xs text-slate-400">(not applicable)</span>}
                </Link>
                <span className="text-xs text-slate-500">
                  {inspectedCount}/{section.components.length} components · {findingCount} finding
                  {findingCount === 1 ? "" : "s"}
                </span>
              </li>
            );
          })}
          {report.sections.length === 0 && <p className="py-2 text-sm text-slate-400">No sections on this report.</p>}
        </ul>
      </section>
    </div>
  );
}
