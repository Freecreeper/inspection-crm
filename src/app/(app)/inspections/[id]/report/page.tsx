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
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Inspection Report</p>
          <h1 className="text-xl font-semibold text-foreground">{report.title || report.reportNumber}</h1>
          <span className="mt-1 inline-block rounded-full bg-info-soft px-2 py-0.5 font-mono text-[11px] text-info-strong">
            {report.status}
          </span>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href={`/inspections/${id}/report/preview`} className="rounded-md border border-input px-3 py-1.5 hover:bg-hover">
            Preview
          </Link>
          <Link href={`/inspections/${id}/report/finalize`} className="rounded-md border border-input px-3 py-1.5 hover:bg-hover">
            Validate &amp; finalize
          </Link>
          <Link href={`/inspections/${id}/report/versions`} className="rounded-md border border-input px-3 py-1.5 hover:bg-hover">
            Versions
          </Link>
        </nav>
      </div>

      {!editable && (
        <section className="rounded-lg border border-warning-border bg-warning-soft p-4 text-sm text-warning-strong">
          This report is {report.status.toLowerCase()} and locked from editing. Use &quot;Amend&quot; from the versions
          page to reopen it.
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Report details</h2>
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
              <label className="block text-xs font-medium text-neutral-600">{label}</label>
              <div className="flex gap-2">
                <textarea
                  name="value"
                  defaultValue={value ?? ""}
                  rows={field === "title" ? 1 : 2}
                  disabled={!editable}
                  className="flex-1 rounded-md border border-input px-2 py-1.5 text-sm disabled:bg-surface-secondary disabled:text-subtle"
                />
                {editable && (
                  <button type="submit" className="self-start rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
                    Save
                  </button>
                )}
              </div>
            </form>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Sections</h2>
        <ul className="mt-2 divide-y divide-neutral-100">
          {report.sections.map((section) => {
            const findingCount = section.components.reduce((sum, c) => sum + c.findings.length, 0);
            const inspectedCount = section.components.filter((c) => c.inspectionStatus !== "NOT_INSPECTED").length;
            return (
              <li key={section.id} className="flex items-center justify-between py-2">
                <Link href={`/inspections/${id}/report/sections/${section.id}`} className="text-sm font-medium text-foreground hover:underline">
                  {section.name}
                  {section.notApplicable && <span className="ml-2 text-xs text-subtle">(not applicable)</span>}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {inspectedCount}/{section.components.length} components · {findingCount} finding
                  {findingCount === 1 ? "" : "s"}
                </span>
              </li>
            );
          })}
          {report.sections.length === 0 && <p className="py-2 text-sm text-subtle">No sections on this report.</p>}
        </ul>
      </section>
    </div>
  );
}
