import Link from "next/link";
import {
  REPORTABLE_ENTITIES,
  getFieldCatalog,
  searchParamsToConfig,
  configToSearchParams,
  runReport,
  type ReportableEntity,
} from "@/lib/reporting";
import { saveReport } from "../actions";
import { ReportTable } from "../ReportTable";

type SP = Record<string, string | string[] | undefined>;

export default async function ReportBuilderPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const entity = typeof sp.entity === "string" ? (sp.entity as ReportableEntity) : undefined;
  const config = searchParamsToConfig(sp);

  const catalog = entity && REPORTABLE_ENTITIES.includes(entity) ? await getFieldCatalog(entity) : [];
  const ownFields = catalog.filter((c) => !c.joinPath);
  const joinedFields = catalog.filter((c) => c.joinPath);
  const aggregableFields = catalog.filter((c) => c.aggregable);

  const hasQuery = config && (config.columns.length > 0 || config.groupBy.length > 0);
  const result = hasQuery && config ? await runReport(config) : null;

  const currentQuery = config ? configToSearchParams(config).toString() : "";

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Custom report builder</h1>
        <Link href="/reports/saved" className="text-sm text-blue-700 hover:underline">
          Saved reports
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">1. Entity</h2>
        <form method="get" className="mt-2 flex gap-2">
          <select name="entity" defaultValue={entity ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="" disabled>
              Select an entity
            </option>
            {REPORTABLE_ENTITIES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Choose
          </button>
        </form>
      </section>

      {entity && (
        <form method="get" className="space-y-6">
          <input type="hidden" name="entity" value={entity} />

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">2. Columns</h2>
            <p className="mt-1 text-xs text-slate-500">Own fields and related-entity fields from the catalog.</p>
            <div className="mt-2 grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
              {[...ownFields, ...joinedFields].map((f) => {
                const key = f.joinPath ? `${f.joinPath}.${f.fieldKey}` : f.fieldKey;
                return (
                  <label key={key} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="columns"
                      value={key}
                      defaultChecked={config?.columns.some((c) => c.fieldKey === key)}
                    />
                    {f.label}
                  </label>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">3. Filters</h2>
            {[0, 1, 2].map((i) => {
              const existing = config?.filters[i];
              return (
                <div key={i} className="mt-2 grid grid-cols-4 gap-2">
                  <select name={`f${i}_field`} defaultValue={existing?.fieldKey ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                    <option value="">—</option>
                    {[...ownFields, ...joinedFields].map((f) => {
                      const key = f.joinPath ? `${f.joinPath}.${f.fieldKey}` : f.fieldKey;
                      return (
                        <option key={key} value={key}>
                          {f.label}
                        </option>
                      );
                    })}
                  </select>
                  <select name={`f${i}_op`} defaultValue={existing?.operator ?? "equals"} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                    <option value="equals">equals</option>
                    <option value="not">not</option>
                    <option value="contains">contains</option>
                    <option value="gt">&gt;</option>
                    <option value="gte">&gt;=</option>
                    <option value="lt">&lt;</option>
                    <option value="lte">&lt;=</option>
                    <option value="isNull">is unknown</option>
                    <option value="isNotNull">is known</option>
                  </select>
                  <input name={`f${i}_value`} defaultValue={existing?.value ?? ""} placeholder="Value" className="col-span-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                </div>
              );
            })}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">4. Group by &amp; aggregate (optional)</h2>
            <p className="mt-1 text-xs text-slate-500">
              Grouping only works on the entity&apos;s own fields — never silently drops NULL/unknown values from the
              total.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
              {ownFields.map((f) => (
                <label key={f.fieldKey} className="flex items-center gap-1.5">
                  <input type="checkbox" name="groupBy" value={f.fieldKey} defaultChecked={config?.groupBy.includes(f.fieldKey)} />
                  {f.label}
                </label>
              ))}
            </div>
            {[0, 1].map((i) => {
              const existing = config?.aggregations[i];
              return (
                <div key={i} className="mt-2 grid grid-cols-2 gap-2">
                  <select name={`a${i}_field`} defaultValue={existing?.fieldKey ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                    <option value="">—</option>
                    {aggregableFields.map((f) => (
                      <option key={f.fieldKey} value={f.fieldKey}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select name={`a${i}_fn`} defaultValue={existing?.fn ?? "count"} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                    <option value="count">Count</option>
                    <option value="sum">Sum</option>
                    <option value="avg">Average</option>
                  </select>
                </div>
              );
            })}
          </section>

          <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Run report
          </button>
        </form>
      )}

      {result && config && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Results</h2>
            <div className="flex gap-2 text-xs">
              <a href={`/api/reports/export?${currentQuery}`} className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50">
                Export CSV
              </a>
              <form action={saveReport}>
                <input type="hidden" name="configJson" value={JSON.stringify(config)} />
                <input name="name" placeholder="Report name" required className="rounded-md border border-slate-300 px-2 py-1" />
                <button type="submit" className="ml-1 rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50">
                  Save
                </button>
              </form>
            </div>
          </div>
          <ReportTable rows={result.rows} reconciledTotal={result.reconciledTotal} />
        </section>
      )}
    </div>
  );
}
