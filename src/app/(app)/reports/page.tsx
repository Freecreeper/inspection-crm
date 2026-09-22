import Link from "next/link";

const STANDARD_REPORTS = [
  { href: "/reports/standard/leads-by-referral-source", label: "Leads by Referral Source" },
  { href: "/reports/standard/transactions-by-status", label: "Transactions by Status" },
  { href: "/reports/standard/inspections-by-city", label: "Inspections by City" },
  { href: "/reports/standard/findings-by-category", label: "Findings by Category" },
];

export default function ReportsDashboardPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
      <p className="text-sm text-slate-500">
        Business intelligence over CRM and inspection data — separate from the Inspection Report Builder, which
        produces the customer-facing PDF for a single inspection.
      </p>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Standard reports</h2>
        <ul className="mt-2 grid grid-cols-2 gap-2">
          {STANDARD_REPORTS.map((r) => (
            <li key={r.href}>
              <Link href={r.href} className="block rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                {r.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Custom report builder</h2>
        <p className="mt-1 text-sm text-slate-600">
          Pick an entity, choose columns from the field catalog, filter, group, and aggregate. Every field is
          validated against an allow-list — never raw SQL.
        </p>
        <Link href="/reports/builder" className="mt-3 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Open builder
        </Link>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Saved reports</h2>
        <Link href="/reports/saved" className="mt-1 inline-block text-sm text-blue-700 hover:underline">
          View saved reports →
        </Link>
      </section>
    </div>
  );
}
