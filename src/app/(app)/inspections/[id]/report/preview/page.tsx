import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPrimaryCustomer } from "@/lib/transactions";

export default async function ReportPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inspection = await prisma.inspection.findUnique({
    where: { id },
    include: {
      property: true,
      inspector: true,
      transaction: { include: { customers: { include: { customer: true } } } },
      reports: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          sections: {
            orderBy: { displayOrder: "asc" },
            include: {
              components: {
                orderBy: { displayOrder: "asc" },
                include: { findings: { orderBy: { displayOrder: "asc" }, include: { category: true, media: true } } },
              },
            },
          },
          summaryItems: { include: { finding: true }, orderBy: { displayOrder: "asc" } },
        },
      },
    },
  });
  if (!inspection) notFound();
  const report = inspection.reports[0];
  if (!report) notFound();

  const primaryCustomer = getPrimaryCustomer(inspection.transaction.customers);
  const groupedSummary = report.summaryItems.reduce<Record<string, typeof report.summaryItems>>((acc, item) => {
    (acc[item.groupLabel] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="max-w-3xl space-y-6">
      <Link href={`/inspections/${id}/report`} className="text-xs text-slate-500 hover:underline">
        ← Back to report
      </Link>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <p className="font-mono text-xs uppercase tracking-wide text-slate-500">{report.reportNumber}</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{report.title || "Property Inspection Report"}</h1>
        <p className="mt-2 text-sm text-slate-700">
          {inspection.property.addressLine1}, {inspection.property.city}, {inspection.property.state} {inspection.property.zip}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600">
          <dt>Prepared for</dt>
          <dd>{primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : "Not recorded"}</dd>
          <dt>Inspector</dt>
          <dd>{inspection.inspector?.name || "Not recorded"}</dd>
          <dt>Inspection date</dt>
          <dd>{(inspection.completedAt ?? inspection.scheduledAt)?.toLocaleDateString() ?? "Not recorded"}</dd>
        </dl>
        {report.introduction && <p className="mt-4 text-sm text-slate-700">{report.introduction}</p>}
      </section>

      {report.summaryItems.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Summary</h2>
          {Object.entries(groupedSummary).map(([group, items]) => (
            <div key={group} className="mt-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">{group}</h3>
              <ul className="mt-1 list-inside list-disc text-sm text-slate-700">
                {items.map((item) => (
                  <li key={item.id}>{item.finding.title}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {report.sections.map((section) => (
        <section key={section.id} className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">{section.name}</h2>
          {section.notApplicable ? (
            <p className="mt-2 text-sm text-slate-400">Not applicable to this property.</p>
          ) : (
            section.components.map((component) => (
              <div key={component.id} className="mt-3 border-t border-slate-100 pt-3 first:mt-0 first:border-0 first:pt-0">
                <p className="text-sm font-medium text-slate-800">
                  {component.name} <span className="font-mono text-[11px] text-slate-400">{component.inspectionStatus}</span>
                </p>
                {component.limitationNote && <p className="text-xs text-slate-500">{component.limitationNote}</p>}
                {component.findings.map((finding) => (
                  <div key={finding.id} className="mt-2 rounded-md bg-slate-50 p-3">
                    <p className="text-sm font-medium text-slate-800">
                      {finding.title} {finding.category && <span className="text-xs text-slate-500">({finding.category.label})</span>}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{finding.description}</p>
                    {finding.recommendation && <p className="mt-1 text-xs text-slate-600">Recommendation: {finding.recommendation}</p>}
                    {finding.media.filter((m) => m.includeInReport).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {finding.media
                          .filter((m) => m.includeInReport)
                          .map((m) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={m.id} src={`/api/media/${m.id}`} alt={m.caption ?? ""} className="h-24 w-32 rounded object-cover" />
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </section>
      ))}

      {report.limitations && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <h2 className="text-sm font-semibold text-slate-900">Limitations</h2>
          <p className="mt-2">{report.limitations}</p>
        </section>
      )}
    </div>
  );
}
