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
    { label: "Upcoming inspections", value: upcomingInspections, href: "/transactions" },
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

      <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Phase 1 foundation: leads, customers, transactions, properties, and the realtor/brokerage
        network. The inspection report builder, billing, and reporting engine land in later phases —
        see the architecture proposal, §26.
      </div>
    </div>
  );
}
