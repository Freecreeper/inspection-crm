import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const [leadCount, activeTransactions, upcomingInspections, openInvoices] = await Promise.all([
    prisma.lead.count({ where: { status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } } }),
    prisma.transaction.count({ where: { archivedAt: null, status: { notIn: ["CLOSED", "CANCELLED"] } } }),
    prisma.inspection.count({ where: { status: "SCHEDULED" } }),
    prisma.invoice.count({ where: { status: { in: ["SENT", "OVERDUE"] } } }),
  ]);

  const tiles = [
    { label: "Open leads", value: leadCount, href: "/leads" },
    { label: "Active transactions", value: activeTransactions, href: "/transactions" },
    { label: "Upcoming inspections", value: upcomingInspections, href: "/inspections" },
    { label: "Unpaid invoices", value: openInvoices, href: "/transactions" },
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300"
          >
            <p className="text-2xl font-semibold tabular-nums text-slate-900">{tile.value}</p>
            <p className="mt-1 text-sm text-slate-500">{tile.label}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <strong>Implemented</strong> — all four pillars: CRM/Operations and Relationship Management
        (leads through documents); the Inspection Report Builder (schedule → sections/components →
        findings → photos → summary → validate → finalize → PDF → deliver via signed link); and
        Business Intelligence (standard reports, a custom report builder with an allow-list query
        service, CSV export, saved reports).
        <br />
        <strong>Partially implemented</strong> — Service/Invoice/Payment exist as schema only, no UI.
        <br />
        <strong>Deferred</strong> — invoicing/payments UI, custom fields UI, automations engine,
        real email delivery (SMTP/Postmark), object storage. See the README for the full breakdown.
      </div>
    </div>
  );
}
