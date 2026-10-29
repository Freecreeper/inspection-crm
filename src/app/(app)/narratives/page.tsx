import { prisma } from "@/lib/prisma";
import { createNarrative, toggleNarrativeActive } from "./actions";

export default async function NarrativesPage() {
  const narratives = await prisma.narrative.findMany({ orderBy: { title: "asc" } });

  return (
    <div>
      <h1 className="text-xl font-semibold text-neutral-900">Narrative library</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Standardized comments inspectors can insert into a Finding — inserting always copies the text into a new
        Finding; editing that copy never changes the library entry here.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Hints</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {narratives.map((n) => {
                  const toggleAction = toggleNarrativeActive.bind(null, n.id);
                  return (
                    <tr key={n.id} className="border-t border-neutral-100">
                      <td className="px-4 py-2">
                        <p className="font-medium text-neutral-900">{n.title}</p>
                        <p className="text-xs text-neutral-500">{n.narrativeText}</p>
                      </td>
                      <td className="px-4 py-2 text-xs text-neutral-500">
                        {[n.sectionHint, n.componentHint].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
                            n.active ? "bg-accent-100 text-accent-700" : "bg-neutral-100 text-neutral-500"
                          }`}
                        >
                          {n.active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <form action={toggleAction}>
                          <input type="hidden" name="nextActive" value={(!n.active).toString()} />
                          <button type="submit" className="text-xs text-blue-700 hover:underline">
                            {n.active ? "Deactivate" : "Reactivate"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
                {narratives.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                      No narratives yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-surface p-4">
          <h2 className="text-sm font-semibold text-neutral-900">New narrative</h2>
          <form action={createNarrative} className="mt-3 space-y-3">
            <input name="title" placeholder="Title" required className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <input name="sectionHint" placeholder="Section hint (optional)" className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
              <input name="componentHint" placeholder="Component hint (optional)" className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
            </div>
            <textarea name="narrativeText" placeholder="Narrative text" required rows={3} className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
            <textarea name="recommendationText" placeholder="Recommendation text (optional)" rows={2} className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
            <button type="submit" className="w-full rounded-md bg-neutral-solid-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-solid-800">
              Add narrative
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
