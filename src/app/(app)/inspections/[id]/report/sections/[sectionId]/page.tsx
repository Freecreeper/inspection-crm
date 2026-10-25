import { SubmitButton } from "@/components/SubmitButton";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isReportEditable } from "@/lib/reportEngine";
import { narrativeFits } from "@/lib/narratives";
import {
  setSectionNotApplicable,
  setComponentStatus,
  createFinding,
  createFindingFromNarrative,
  updateFinding,
  deleteFinding,
  uploadMedia,
  deleteMedia,
} from "../../../../report-actions";

export default async function SectionEditorPage({
  params,
}: {
  params: Promise<{ id: string; sectionId: string }>;
}) {
  const { id, sectionId } = await params;
  const [section, categories, narratives] = await Promise.all([
    prisma.reportSection.findUnique({
      where: { id: sectionId },
      include: {
        report: true,
        components: {
          orderBy: { displayOrder: "asc" },
          include: {
            findings: {
              orderBy: { displayOrder: "asc" },
              include: { category: true, media: true },
            },
          },
        },
      },
    }),
    prisma.findingCategory.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } }),
    // The whole active library, lightly (no narrative text): capping it
    // before matching hid most component-specific narratives.
    prisma.narrative.findMany({ where: { active: true }, orderBy: { title: "asc" }, select: { id: true, title: true, componentHint: true, sectionHint: true } }),
  ]);
  if (!section || section.report.inspectionId !== id) notFound();

  const editable = isReportEditable(section.report.status);
  const notApplicableAction = setSectionNotApplicable.bind(null, section.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/inspections/${id}/report`} className="text-xs text-slate-500 hover:underline">
          ← Back to report
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{section.name}</h1>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <form action={notApplicableAction} className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="notApplicable" value="true" defaultChecked={section.notApplicable} disabled={!editable} />
            Mark this entire section not applicable
          </label>
          <input
            name="defaultNarrative"
            defaultValue={section.defaultNarrative ?? ""}
            placeholder="Reason (optional)"
            disabled={!editable}
            className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
          />
          {editable && (
            <SubmitButton className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Save
            </SubmitButton>
          )}
        </form>
      </section>

      {!section.notApplicable &&
        section.components.map((component) => {
          const statusAction = setComponentStatus.bind(null, component.id);
          const findingAction = createFinding.bind(null, component.id);
          const needsReason = ["NOT_INSPECTED", "NOT_ACCESSIBLE", "LIMITED_INSPECTION"].includes(component.inspectionStatus);

          return (
            <section key={component.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-900">{component.name}</h2>

              <form action={statusAction} className="mt-2 grid grid-cols-2 gap-2">
                <select name="inspectionStatus" defaultValue={component.inspectionStatus} disabled={!editable} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50">
                  <option value="INSPECTED">Inspected</option>
                  <option value="NOT_INSPECTED">Not inspected</option>
                  <option value="NOT_PRESENT">Not present</option>
                  <option value="NOT_ACCESSIBLE">Not accessible</option>
                  <option value="LIMITED_INSPECTION">Limited inspection</option>
                  <option value="NOT_APPLICABLE">Not applicable</option>
                </select>
                <input name="materialType" defaultValue={component.materialType ?? ""} placeholder="Material / type" disabled={!editable} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50" />
                <input
                  name="limitationNote"
                  defaultValue={component.limitationNote ?? ""}
                  placeholder={needsReason ? "Reason (recommended for finalization)" : "Limitation note (optional)"}
                  disabled={!editable}
                  className="col-span-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
                />
                <textarea name="notes" defaultValue={component.notes ?? ""} placeholder="Notes" rows={2} disabled={!editable} className="col-span-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50" />
                {editable && (
                  <SubmitButton className="col-span-2 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                    Save component
                  </SubmitButton>
                )}
              </form>

              <div className="mt-4 space-y-3">
                {component.findings.map((finding) => {
                  const updateAction = updateFinding.bind(null, finding.id);
                  const deleteAction = deleteFinding.bind(null, finding.id);
                  const mediaAction = uploadMedia.bind(null, section.report.inspectionId, finding.id);
                  return (
                    <div key={`${finding.id}:${finding.updatedAt.getTime()}`} className="rounded-md border border-slate-200 p-3">
                      <form action={updateAction} className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input name="title" defaultValue={finding.title} required disabled={!editable} placeholder="Title" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50" />
                          <select name="categoryId" defaultValue={finding.categoryId ?? ""} disabled={!editable} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50">
                            <option value="">No category</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <textarea name="description" defaultValue={finding.description} required rows={2} disabled={!editable} placeholder="Description" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50" />
                        <input name="location" defaultValue={finding.location ?? ""} placeholder="Location" disabled={!editable} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50" />
                        <textarea name="recommendation" defaultValue={finding.recommendation ?? ""} rows={2} placeholder="Recommendation" disabled={!editable} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50" />
                        <input name="recommendedProfessional" defaultValue={finding.recommendedProfessional ?? ""} placeholder="Recommended professional (e.g. licensed electrician)" disabled={!editable} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50" />
                        <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                          {(
                            [
                              ["safetyRelated", "Safety related"],
                              ["repairRecommended", "Repair recommended"],
                              ["monitor", "Monitor"],
                              ["furtherEvaluation", "Further evaluation"],
                              ["includedInSummary", "Include in summary"],
                            ] as const
                          ).map(([name, label]) => (
                            <label key={name} className="flex items-center gap-1">
                              <input type="checkbox" name={name} value="true" defaultChecked={finding[name]} disabled={!editable} />
                              {label}
                            </label>
                          ))}
                        </div>
                        {editable && (
                          <SubmitButton className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
                            Save finding
                          </SubmitButton>
                        )}
                      </form>

                      <div className="mt-2 flex flex-wrap gap-2">
                        {finding.media.map((m) => (
                          <div key={m.id} className="relative">
                            <img src={`/api/media/${m.id}`} alt={m.caption ?? ""} className="h-20 w-28 rounded object-cover" />
                            {editable && (
                              <form action={deleteMedia.bind(null, m.id)} className="absolute right-0 top-0">
                                <SubmitButton className="rounded bg-black/60 px-1 text-[10px] text-white" confirm="Remove this photo?">
                                  ×
                                </SubmitButton>
                              </form>
                            )}
                          </div>
                        ))}
                      </div>
                      {editable && (
                        <form action={mediaAction} className="mt-2 flex gap-2">
                          <input name="file" type="file" accept="image/*" required className="text-xs" />
                          <input name="caption" placeholder="Caption (optional)" className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs" />
                          <SubmitButton className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                            Add photo
                          </SubmitButton>
                        </form>
                      )}

                      {editable && (
                        <form action={deleteAction} className="mt-2">
                          <SubmitButton className="text-xs text-red-600 hover:underline" confirm="Remove this finding and its photos?">
                            Remove finding
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>

              {editable && (
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium text-slate-600">Add a finding</p>
                  <form action={findingAction} className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input name="title" placeholder="Title" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                      <select name="categoryId" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                        <option value="">No category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea name="description" placeholder="Description" required rows={2} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                    <SubmitButton className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
                      Add custom finding
                    </SubmitButton>
                  </form>

                  {(() => {
                    const fitting = narratives.filter((n) => narrativeFits(n, component.name, section.name));
                    if (fitting.length === 0) return null;
                    return (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-slate-600">
                          Or insert from the narrative library ({fitting.length} for {component.name})
                        </summary>
                        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                          {fitting.map((n) => (
                            <li key={n.id} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1">
                              <span>{n.title}</span>
                              <form action={createFindingFromNarrative.bind(null, component.id, n.id)}>
                                <SubmitButton className="text-blue-700 hover:underline">Insert</SubmitButton>
                              </form>
                            </li>
                          ))}
                        </ul>
                      </details>
                    );
                  })()}
                </div>
              )}
            </section>
          );
        })}
    </div>
  );
}
