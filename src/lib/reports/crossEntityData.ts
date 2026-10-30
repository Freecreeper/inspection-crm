import { prisma } from "@/lib/prisma";
import { billedInvoiceWhere } from "@/lib/dashboard/metrics";
import { BILLED_INVOICE_STATUSES } from "@/lib/realtors/metrics";
import { realtorDisplayName } from "@/lib/realtors/display";
import { formatMoney } from "@/lib/invoices";
import {
  byBrokerage,
  byRealtor,
  byReferralSource,
  percent,
  totalsOf,
  type Period,
  type ResolvedPeriod,
  type Totals,
  type TransactionFacts,
} from "./crossEntity";
import { Prisma } from "@prisma/client";

// The facts behind the cross-entity reports for one period: a handful of
// typed, parameterized Prisma queries (no raw SQL), one row per
// transaction that had any activity in the period. Archived transactions
// are left out, as everywhere else in reporting.
async function loadFacts(period: Period | null) {
  const inRange = period ? { gte: period.start, lt: period.end } : undefined;
  const [invoices, inspections, started, leads] = await Promise.all([
    prisma.invoice.findMany({
      where: { ...(period ? billedInvoiceWhere(period) : { status: { in: BILLED_INVOICE_STATUSES } }), transaction: { archivedAt: null } },
      select: { transactionId: true, items: { select: { amount: true } } },
    }),
    prisma.inspection.findMany({
      where: { status: { not: "CANCELLED" }, transaction: { archivedAt: null }, ...(inRange ? { scheduledAt: inRange } : {}) },
      select: { transactionId: true },
    }),
    prisma.transaction.findMany({ where: { archivedAt: null, ...(inRange ? { createdAt: inRange } : {}) }, select: { id: true } }),
    prisma.lead.findMany({ where: inRange ? { createdAt: inRange } : {}, select: { referralSourceId: true, status: true } }),
  ]);

  const revenue = new Map<string, Prisma.Decimal>();
  for (const inv of invoices) {
    const sum = inv.items.reduce((acc, i) => acc.plus(i.amount), revenue.get(inv.transactionId) ?? new Prisma.Decimal(0));
    revenue.set(inv.transactionId, sum);
  }
  const inspectionCount = new Map<string, number>();
  for (const i of inspections) inspectionCount.set(i.transactionId, (inspectionCount.get(i.transactionId) ?? 0) + 1);
  const startedIds = new Set(started.map((t) => t.id));
  const ids = [...new Set([...revenue.keys(), ...inspectionCount.keys(), ...startedIds])];

  const transactions = ids.length
    ? await prisma.transaction.findMany({
        where: { id: { in: ids } },
        select: { id: true, referralSourceId: true, realtors: { select: { realtorId: true, brokerageId: true, brokerageName: true } } },
      })
    : [];
  const facts: TransactionFacts[] = transactions.map((t) => ({
    id: t.id,
    startedInPeriod: startedIds.has(t.id),
    inspections: inspectionCount.get(t.id) ?? 0,
    revenue: revenue.get(t.id) ?? new Prisma.Decimal(0),
    referralSourceId: t.referralSourceId,
    realtors: t.realtors,
  }));
  return { facts, leads: leads.map((l) => ({ referralSourceId: l.referralSourceId, converted: l.status === "CONVERTED" })) };
}

// ------------------------------------------------------------------ the reports

export interface Column {
  key: string;
  label: string;
  numeric?: boolean;
  financial?: boolean; // left out entirely for viewers without financial:read
}

export interface ReportRow {
  cells: Record<string, string>;
  href?: string;
  muted?: boolean; // "no source" / "no Realtor" style rows
}

export interface CrossEntityReport {
  title: string;
  columns: Column[];
  rows: ReportRow[];
  totals: Record<string, string> | null;
  notes: string[];
}

export const CROSS_ENTITY_REPORTS = {
  "revenue-by-realtor": { title: "Revenue by Realtor", blurb: "Billed revenue, transactions and inspections for each Realtor on the deal, plus what they referred." },
  "revenue-by-brokerage": { title: "Revenue by Brokerage", blurb: "Billed revenue, transactions and inspections for each brokerage, as recorded on the deal." },
  "revenue-by-referral-source": { title: "Revenue by Referral Source", blurb: "Leads, conversion, transactions, inspections and billed revenue for each referral source." },
} as const;
export type CrossEntitySlug = keyof typeof CROSS_ENTITY_REPORTS;

export function isCrossEntitySlug(slug: string): slug is CrossEntitySlug {
  return slug in CROSS_ENTITY_REPORTS;
}

const money = (d: Prisma.Decimal) => formatMoney(d);
const totalCells = (t: Totals) => ({ transactions: String(t.transactions), inspections: String(t.inspections), revenue: money(t.revenue) });
const DEFINITIONS =
  "Transactions are those started in the period; inspections are those scheduled in it (not cancelled); billed revenue is invoice lines on sent, partly paid, paid or overdue invoices dated in it (drafts and voids never count). Billed, not collected.";

export async function buildCrossEntityReport(slug: CrossEntitySlug, range: ResolvedPeriod, opts: { includeFinancials: boolean }): Promise<CrossEntityReport> {
  const { facts, leads } = await loadFacts(range.period);
  const overall = totalsOf(facts);
  const keep = (cols: Column[]) => cols.filter((c) => opts.includeFinancials || !c.financial);
  const title = CROSS_ENTITY_REPORTS[slug].title;

  if (slug === "revenue-by-referral-source") {
    const sources = await prisma.referralSource.findMany({ select: { id: true, name: true, type: true, realtorId: true } });
    const rows = byReferralSource(facts, new Map(sources.map((s) => [s.id, s])), leads);
    const leadTotal = leads.length;
    const converted = leads.filter((l) => l.converted).length;
    return {
      title,
      columns: keep([
        { key: "source", label: "Referral source" },
        { key: "type", label: "Type" },
        { key: "leads", label: "Leads", numeric: true },
        { key: "converted", label: "Converted", numeric: true },
        { key: "rate", label: "Conversion", numeric: true },
        { key: "transactions", label: "Transactions", numeric: true },
        { key: "inspections", label: "Inspections", numeric: true },
        { key: "revenue", label: "Billed revenue", numeric: true, financial: true },
      ]),
      rows: rows.map((r) => ({
        cells: { source: r.name, type: r.type ?? "—", leads: String(r.leads), converted: String(r.leadsConverted), rate: percent(r.leadsConverted, r.leads), ...totalCells(r) },
        href: r.realtorId ? `/realtors/${r.realtorId}` : undefined,
        muted: r.key === "none",
      })),
      totals: { source: "Total", type: "", leads: String(leadTotal), converted: String(converted), rate: percent(converted, leadTotal), ...totalCells(overall) },
      notes: [
        "Each transaction has at most one referral source, so the rows add up to the total.",
        "Leads are those created in the period; converted counts how many of them have since become customers.",
        DEFINITIONS,
      ],
    };
  }

  // Realtors on those deals (and the ones behind referral sources), with where they work now.
  const sources = await prisma.referralSource.findMany({ where: { realtorId: { not: null } }, select: { id: true, realtorId: true } });
  const sourceRealtor = new Map(sources.map((s) => [s.id, s.realtorId!]));

  if (slug === "revenue-by-realtor") {
    const realtorIds = [...new Set([...facts.flatMap((f) => f.realtors.map((r) => r.realtorId)), ...sourceRealtor.values()])];
    const realtors = realtorIds.length
      ? await prisma.realtor.findMany({ where: { id: { in: realtorIds } }, select: { id: true, firstName: true, lastName: true, preferredName: true, brokerage: { select: { name: true } } } })
      : [];
    const { rows, withoutRealtor } = byRealtor(facts, new Map(realtors.map((r) => [r.id, { name: realtorDisplayName(r), brokerage: r.brokerage?.name ?? null }])), sourceRealtor);
    return {
      title,
      columns: keep([
        { key: "realtor", label: "Realtor" },
        { key: "brokerage", label: "Brokerage (now)" },
        { key: "transactions", label: "Transactions", numeric: true },
        { key: "inspections", label: "Inspections", numeric: true },
        { key: "revenue", label: "Billed revenue", numeric: true, financial: true },
        { key: "referrals", label: "Referred", numeric: true },
        { key: "referralRevenue", label: "Referred revenue", numeric: true, financial: true },
      ]),
      rows: [
        ...rows.map((r) => ({
          cells: { realtor: r.name, brokerage: r.brokerage ?? "—", ...totalCells(r), referrals: String(r.referrals), referralRevenue: money(r.referralRevenue) },
          href: `/realtors/${r.key}`,
        })),
        ...(withoutRealtor.transactions || withoutRealtor.inspections || !withoutRealtor.revenue.isZero()
          ? [{ cells: { realtor: "No Realtor on the deal", brokerage: "", ...totalCells(withoutRealtor), referrals: "", referralRevenue: "" }, muted: true }]
          : []),
      ],
      totals: { realtor: "All transactions", brokerage: "", ...totalCells(overall), referrals: "", referralRevenue: "" },
      notes: [
        "Every Realtor on a deal, in any role, is credited with all of it, so a deal with a buyer's agent and a listing agent counts for both and the rows add up to more than the total.",
        "Referred means the transaction's referral source is that Realtor; being on a deal never counts as a referral.",
        DEFINITIONS,
      ],
    };
  }

  const brokerageIds = [...new Set(facts.flatMap((f) => f.realtors.map((r) => r.brokerageId).filter((id): id is string => Boolean(id))))];
  const brokerages = brokerageIds.length ? await prisma.brokerage.findMany({ where: { id: { in: brokerageIds } }, select: { id: true, name: true } }) : [];
  const { rows, withoutRealtor } = byBrokerage(facts, new Map(brokerages.map((b) => [b.id, b.name])));
  return {
    title,
    columns: keep([
      { key: "brokerage", label: "Brokerage" },
      { key: "realtors", label: "Realtors", numeric: true },
      { key: "transactions", label: "Transactions", numeric: true },
      { key: "inspections", label: "Inspections", numeric: true },
      { key: "revenue", label: "Billed revenue", numeric: true, financial: true },
    ]),
    rows: [
      ...rows.map((r) => ({
        cells: { brokerage: r.name, realtors: String(r.realtors), ...totalCells(r) },
        href: r.key.startsWith("name:") || r.key === "independent" ? undefined : `/brokerages/${r.key}`,
        muted: r.key === "independent",
      })),
      ...(withoutRealtor.transactions || withoutRealtor.inspections || !withoutRealtor.revenue.isZero()
        ? [{ cells: { brokerage: "No Realtor on the deal", realtors: "", ...totalCells(withoutRealtor) }, muted: true }]
        : []),
    ],
    totals: { brokerage: "All transactions", realtors: "", ...totalCells(overall) },
    notes: [
      "A deal is credited to the brokerage recorded for each Realtor on it at the time, not where they work now, and once per brokerage however many of its agents were on it.",
      "A deal with agents from two brokerages counts for both, so the rows add up to more than the total.",
      DEFINITIONS,
    ],
  };
}

// The same report as plain rows for CSV: one column per visible column.
export function reportToCsvRows(report: CrossEntityReport): Record<string, string>[] {
  const line = (cells: Record<string, string>) => Object.fromEntries(report.columns.map((c) => [c.label, cells[c.key] ?? ""]));
  return [...report.rows.map((r) => line(r.cells)), ...(report.totals ? [line(report.totals)] : [])];
}
