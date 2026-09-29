import Link from "next/link";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getCalendarConfig } from "@/lib/calendar/config";
import { formatDay, formatMonth, startOfMonth, toDayKey } from "@/lib/calendar/time";
import { formatMoney, invoiceTotals, isInvoiceCollectible } from "@/lib/invoices";
import { billedInvoiceWhere, monthPeriod } from "@/lib/dashboard/metrics";
import { COLLECTIBLE_INVOICE_STATUSES } from "@/lib/dashboard/sources";

// A read-only invoice list: what's owed, and what was billed this month —
// the same definitions the Dashboard's financial KPIs use, so a number on
// the Dashboard always has a list behind it. Financial roles only.
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  if (!can(role, "financial:read")) {
    return <p className="text-sm text-slate-600">You don&apos;t have access to invoices.</p>;
  }
  const { view: rawView } = await searchParams;
  const view = rawView === "billed" ? "billed" : "outstanding";
  const { timeZone } = getCalendarConfig();
  const today = toDayKey(new Date(), timeZone);

  const rows = await prisma.invoice.findMany({
    where: view === "billed" ? billedInvoiceWhere(monthPeriod(today, timeZone)) : { status: { in: [...COLLECTIBLE_INVOICE_STATUSES] } },
    orderBy: view === "billed" ? [{ issuedAt: "desc" }, { createdAt: "desc" }] : [{ dueAt: "asc" }, { createdAt: "asc" }],
    take: 200,
    include: {
      items: { select: { amount: true } },
      payments: { select: { amount: true } },
      transaction: {
        select: {
          id: true,
          property: { select: { addressLine1: true, city: true } },
          customers: { select: { primaryContact: true, customer: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  });

  const invoices = rows
    .map((inv) => {
      const totals = invoiceTotals(inv);
      const c = (inv.transaction.customers.find((r) => r.primaryContact) ?? inv.transaction.customers[0])?.customer;
      const due = inv.dueAt ? toDayKey(inv.dueAt, timeZone) : null;
      return { inv, totals, customer: c ? `${c.firstName} ${c.lastName}` : null, due, overdue: due !== null && due < today && isInvoiceCollectible(inv.status, totals.balance) };
    })
    .filter((r) => view === "billed" || isInvoiceCollectible(r.inv.status, r.totals.balance));

  const sum = invoices.reduce((n, r) => n + Number((view === "billed" ? r.totals.total : r.totals.balance).toString()), 0);
  const tab = (key: string, label: string) => (
    <Link
      href={key === "outstanding" ? "/invoices" : `/invoices?view=${key}`}
      aria-current={view === key ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-900">Invoices</h1>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Invoice views" className="flex gap-1">
          {tab("outstanding", "Outstanding")}
          {tab("billed", `Billed in ${formatMonth(startOfMonth(today))}`)}
        </nav>
        <p className="text-sm text-slate-600">
          {invoices.length} invoice{invoices.length === 1 ? "" : "s"} · <span className="font-semibold text-slate-900">{formatMoney(sum)}</span> {view === "billed" ? "billed" : "due"}
          {view === "billed" && invoices.length > 0 && <> · average {formatMoney(sum / invoices.length)}</>}
        </p>
      </div>
      {view === "billed" && (
        <p className="mt-2 text-xs text-slate-500">
          Billed revenue: invoice line items on invoices sent, partly paid, paid, or overdue, dated this month (issue date, or created date if never issued). Drafts and voids excluded.
        </p>
      )}
      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Invoice</th>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Due</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
              <th className="px-4 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map(({ inv, totals, customer, due, overdue }) => (
              <tr key={inv.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link href={`/transactions/${inv.transaction.id}`} className="font-medium text-slate-900 hover:underline">
                    {inv.invoiceNumber}
                  </Link>
                  {inv.transaction.property && <span className="block text-xs text-slate-500">{inv.transaction.property.addressLine1}, {inv.transaction.property.city}</span>}
                </td>
                <td className="px-4 py-2 text-slate-600">{customer ?? <span className="text-slate-400">No customer</span>}</td>
                <td className="px-4 py-2 text-slate-600">{inv.status.toLowerCase().replace(/_/g, " ")}</td>
                <td className={`px-4 py-2 tabular-nums ${overdue ? "font-medium text-amber-800" : "text-slate-600"}`}>
                  {due ? formatDay(due, "short") : <span className="text-slate-400">—</span>}
                  {overdue && <span className="ml-1 text-xs">(overdue)</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">{formatMoney(totals.total)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-900">{formatMoney(totals.balance)}</td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  {view === "billed" ? "Nothing billed this month yet." : "No balances due."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
