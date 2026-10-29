import Link from "next/link";
import { prisma } from "@/lib/prisma";

// The structure every report is copied from: sections and the components
// inside them. Read-only for now; this is where report areas will be
// switched on and off per package.
export default async function ReportTemplatesPage() {
  const templates = await prisma.reportTemplate.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      sections: {
        orderBy: { displayOrder: "asc" },
        include: { components: { orderBy: { displayOrder: "asc" }, select: { id: true, name: true, active: true } } },
      },
      _count: { select: { reports: true } },
    },
  });

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-neutral-900">Report Templates</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Each inspection report starts as a copy of a template. Editing here will come with packages; reports already started keep their own copy.
      </p>

      <div className="mt-6 space-y-4">
        {templates.map((t) => {
          const components = t.sections.reduce((n, s) => n + s.components.length, 0);
          return (
            <section key={t.id} aria-labelledby={`tpl-${t.id}`} className={`rounded-lg border border-neutral-200 bg-surface p-4 ${t.active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`tpl-${t.id}`} className="text-sm font-semibold text-neutral-900">
                  {t.name}
                  {!t.active && <span className="ml-2 text-xs font-normal text-neutral-500">(retired)</span>}
                </h2>
                <p className="text-xs text-neutral-500">
                  {t.sections.length} sections · {components} components · used by {t._count.reports} report{t._count.reports === 1 ? "" : "s"}
                </p>
              </div>
              {t.description && <p className="mt-1 text-sm text-neutral-600">{t.description}</p>}
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {t.sections.map((s) => (
                  <li key={s.id} className={`rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2 ${s.active ? "" : "text-neutral-400"}`}>
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-neutral-800">
                        {s.name} <span className="text-xs font-normal text-neutral-500">({s.components.length})</span>
                        {!s.active && <span className="ml-1 text-xs font-normal">· off</span>}
                      </summary>
                      <ul className="mt-1.5 space-y-0.5 pl-1 text-xs text-neutral-600">
                        {s.components.map((c) => (
                          <li key={c.id} className={c.active ? "" : "text-neutral-400 line-through"}>
                            {c.name}
                          </li>
                        ))}
                        {s.components.length === 0 && <li className="text-neutral-400">No components</li>}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {templates.length === 0 && <p className="rounded-lg border border-neutral-200 bg-surface p-8 text-center text-sm text-neutral-500">No report templates yet.</p>}
      </div>
      <p className="mt-3 text-xs text-neutral-500">
        Prices and lengths live in <Link href="/services" className="text-accent-700 hover:underline">Services &amp; Packages</Link>.
      </p>
    </div>
  );
}
