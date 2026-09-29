import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, addMonths, startOfDayUtc, startOfMonth, startOfWeek, type DayKey } from "@/lib/calendar/time";
import { BILLED_INVOICE_STATUSES } from "@/lib/realtors/metrics";
import { SCHEDULING_HORIZON_DAYS } from "./attention";
import { canUseKpi, type KpiKey } from "./registry";
import type { DashboardContext } from "./sources";
import type { KpiValue } from "./types";

// Business Snapshot KPIs. Every figure is a database count/sum over the
// authoritative records with a written definition (registry.ts, and
// docs/dashboard.md) — never estimated, never computed in the browser.
//
// REVENUE (billed basis, the same one Realtor metrics use): the sum of
// invoice line items on invoices in a billed status (SENT, PARTIALLY_PAID,
// PAID, OVERDUE) whose invoice date falls in the period. The invoice date
// is `issuedAt`, or `createdAt` when an invoice was never stamped as
// issued. Drafts and voids never count. This is billed, not collected.
//
// AVERAGE INSPECTION VALUE: that same revenue ÷ the number of those same
// invoices — one invoice per inspection job — so the two can't disagree.
//
// REFERRALS: transactions started in the period that have a referral
// source. Only a Referral Source attributes a referral; a Realtor merely
// being on a deal (TransactionRealtor) never does.

export interface Period {
  start: Date;
  end: Date;
}

export function monthPeriod(today: DayKey, timeZone: string): Period {
  const first = startOfMonth(today);
  return { start: startOfDayUtc(first, timeZone), end: startOfDayUtc(addMonths(first, 1), timeZone) };
}

export function weekPeriod(today: DayKey, timeZone: string, weekStartsOn: number): Period {
  const first = startOfWeek(today, weekStartsOn);
  return { start: startOfDayUtc(first, timeZone), end: startOfDayUtc(addDays(first, 7), timeZone) };
}

const range = (p: Period) => ({ gte: p.start, lt: p.end });

export function billedInvoiceWhere(p: Period): Prisma.InvoiceWhereInput {
  return {
    status: { in: BILLED_INVOICE_STATUSES },
    OR: [{ issuedAt: range(p) }, { issuedAt: null, createdAt: range(p) }],
  };
}

const ACTIVE_INSPECTION = ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] as const;

function money(d: Prisma.Decimal | null | undefined): number {
  return d ? Math.round(Number(d.toString()) * 100) / 100 : 0;
}

export async function loadKpis(ctx: DashboardContext, keys: KpiKey[]): Promise<KpiValue[]> {
  const { timeZone, weekStartsOn } = ctx.config;
  const month = monthPeriod(ctx.today, timeZone);
  const week = weekPeriod(ctx.today, timeZone, weekStartsOn);

  // Revenue and average share one pair of queries.
  let billed: Promise<{ revenue: number; invoices: number }> | null = null;
  const billedThisMonth = () =>
    (billed ??= Promise.all([
      prisma.invoiceItem.aggregate({ _sum: { amount: true }, where: { invoice: billedInvoiceWhere(month) } }),
      prisma.invoice.count({ where: billedInvoiceWhere(month) }),
    ]).then(([sum, invoices]) => ({ revenue: money(sum._sum.amount), invoices })));

  const calculators: Record<KpiKey, () => Promise<number | null>> = {
    inspectionsMonth: () => prisma.inspection.count({ where: { status: { in: [...ACTIVE_INSPECTION] }, scheduledAt: range(month) } }),
    inspectionsWeek: () => prisma.inspection.count({ where: { status: { in: [...ACTIVE_INSPECTION] }, scheduledAt: range(week) } }),
    revenueMonth: async () => (await billedThisMonth()).revenue,
    avgInspectionValue: async () => {
      const { revenue, invoices } = await billedThisMonth();
      return invoices > 0 ? Math.round((revenue / invoices) * 100) / 100 : null;
    },
    referralsMonth: () => prisma.transaction.count({ where: { referralSourceId: { not: null }, createdAt: range(month) } }),
    realtorReferralsMonth: () => prisma.transaction.count({ where: { referralSource: { realtorId: { not: null } }, createdAt: range(month) } }),
    outstandingBalance: async () => money((await ctx.collectibleInvoices()).reduce((sum, inv) => sum.plus(inv.balance), new Prisma.Decimal(0))),
    unpaidInvoices: async () => (await ctx.collectibleInvoices()).length,
    reportsAwaiting: () => ctx.unfinishedReportCount(),
    unsignedAgreements: () =>
      prisma.inspection.count({
        where: { status: "SCHEDULED", agreementSignedAt: null, scheduledAt: { gte: ctx.startOfToday, lt: startOfDayUtc(addDays(ctx.today, SCHEDULING_HORIZON_DAYS + 1), timeZone) } },
      }),
    newLeadsMonth: () => prisma.lead.count({ where: { createdAt: range(month) } }),
    overdueTasks: () => prisma.task.count({ where: { completedAt: null, dueAt: { lt: ctx.startOfToday } } }),
  };

  // The server decides: a KPI the role can't see is never calculated,
  // whatever the stored preference or the request says.
  const allowed = keys.filter((k) => canUseKpi(ctx.viewer.role, k));
  return Promise.all(allowed.map(async (key) => ({ key, value: await calculators[key]() })));
}
