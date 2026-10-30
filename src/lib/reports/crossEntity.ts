// Pure: the cross-entity Standard Reports — billed revenue, transactions,
// inspections and lead conversion by Realtor, by Brokerage and by Referral
// Source. The generic report builder can't group across a relation on
// purpose (see README, "Custom reporting cannot currently group or
// aggregate across a relation"); these are fixed, hand-written reports
// instead. The loader (crossEntityData.ts) runs a few bounded, typed
// queries; everything here turns those facts into rows, so the attribution
// rules live in one tested place.
//
// Definitions, each counted on its own date within the chosen period:
// - Billed revenue: line items of invoices in a billed status (sent, partly
//   paid, paid, overdue) dated in the period — the invoice's issue date, or
//   its created date if never issued. The same basis as the Dashboard and
//   Realtor pages. Drafts and voids never count. Billed, not collected.
// - Transactions: transactions started (created) in the period.
// - Inspections: inspections scheduled in the period, not cancelled.
// - Leads / converted: leads created in the period, and how many of those
//   have since converted.
//
// Attribution:
// - Referral source: a transaction has at most one, so its rows add up
//   exactly to the totals (with a "No referral source" row).
// - Realtor "on the deal": every Realtor on the transaction in any role is
//   credited with all of it (once, even if they hold two roles). A deal
//   with a buyer's and a listing agent counts for both, so these rows add
//   up to more than the totals; that is shown, not hidden.
// - Realtor "referred": the transaction's referral source belongs to that
//   Realtor. Being on a deal never implies a referral.
// - Brokerage: the brokerage recorded on the transaction for each Realtor
//   at the time (not where they work now), credited once per transaction.

import { Prisma } from "@prisma/client";
import { addDays, addMonths, isDayKey, startOfDayUtc, startOfMonth, type DayKey } from "@/lib/calendar/time";

export interface Period {
  start: Date;
  end: Date;
}

export const PERIOD_OPTIONS = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "this-year", label: "This year" },
  { key: "last-12-months", label: "Last 12 months" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom dates" },
] as const;
export type PeriodKey = (typeof PERIOD_OPTIONS)[number]["key"];

export interface ResolvedPeriod {
  key: PeriodKey;
  // null = all time.
  period: Period | null;
  from: DayKey | null; // first day, inclusive
  to: DayKey | null; // last day, inclusive
  label: string;
}

const longDay = (day: DayKey) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// The same calendar day a year earlier (Feb 29 → Feb 28). addMonths can't
// be used here: it returns the first of the month.
function sameDayLastYear(day: DayKey): DayKey {
  const [y, m, d] = day.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

// The period from the page's ?period= (and ?from=&to= for custom dates).
// Anything unrecognized falls back to this year.
export function resolvePeriod(sp: { period?: string; from?: string; to?: string }, today: DayKey, timeZone: string): ResolvedPeriod {
  const key = (PERIOD_OPTIONS.some((o) => o.key === sp.period) ? sp.period : "this-year") as PeriodKey;
  const span = (from: DayKey, toInclusive: DayKey, k: PeriodKey): ResolvedPeriod => ({
    key: k,
    period: { start: startOfDayUtc(from, timeZone), end: startOfDayUtc(addDays(toInclusive, 1), timeZone) },
    from,
    to: toInclusive,
    label: `${longDay(from)} – ${longDay(toInclusive)}`,
  });
  const month = startOfMonth(today);
  switch (key) {
    case "this-month":
      return span(month, today, key);
    case "last-month": {
      const first = addMonths(month, -1);
      return span(first, addDays(month, -1), key);
    }
    case "last-12-months":
      return span(addDays(sameDayLastYear(today), 1), today, key);
    case "all":
      return { key, period: null, from: null, to: null, label: "All time" };
    case "custom": {
      const from = sp.from && isDayKey(sp.from) ? sp.from : null;
      const to = sp.to && isDayKey(sp.to) ? sp.to : null;
      if (from && to) return from <= to ? span(from, to, key) : span(to, from, key);
      if (from) return span(from, today >= from ? today : from, key);
      if (to) return span(`${to.slice(0, 4)}-01-01`, to, key);
      return resolvePeriod({ period: "this-year" }, today, timeZone);
    }
    case "this-year":
    default:
      return span(`${today.slice(0, 4)}-01-01`, today, "this-year");
  }
}

// --------------------------------------------------------------------- facts

// One transaction, as far as these reports care.
export interface TransactionFacts {
  id: string;
  startedInPeriod: boolean;
  inspections: number;
  revenue: Prisma.Decimal;
  referralSourceId: string | null;
  realtors: { realtorId: string; brokerageId: string | null; brokerageName: string | null }[];
}

export interface Totals {
  transactions: number;
  inspections: number;
  revenue: Prisma.Decimal;
}

const ZERO = () => new Prisma.Decimal(0);
const emptyTotals = (): Totals => ({ transactions: 0, inspections: 0, revenue: ZERO() });

function add(t: Totals, f: TransactionFacts) {
  if (f.startedInPeriod) t.transactions++;
  t.inspections += f.inspections;
  t.revenue = t.revenue.plus(f.revenue);
}

const hasActivity = (t: Totals) => t.transactions > 0 || t.inspections > 0 || !t.revenue.isZero();

export function totalsOf(facts: TransactionFacts[]): Totals {
  const t = emptyTotals();
  for (const f of facts) add(t, f);
  return t;
}

const byRevenue = <T extends { revenue: Prisma.Decimal; transactions: number; name: string }>(a: T, b: T) =>
  b.revenue.comparedTo(a.revenue) || b.transactions - a.transactions || a.name.localeCompare(b.name);

// ------------------------------------------------------------ by referral source

export interface ReferralSourceRow extends Totals {
  key: string; // source id, or "none"
  name: string;
  type: string | null;
  realtorId: string | null;
  leads: number;
  leadsConverted: number;
}

export function byReferralSource(
  facts: TransactionFacts[],
  sources: Map<string, { name: string; type: string; realtorId: string | null }>,
  leads: { referralSourceId: string | null; converted: boolean }[]
): ReferralSourceRow[] {
  const rows = new Map<string, ReferralSourceRow>();
  const row = (id: string | null) => {
    const key = id ?? "none";
    let r = rows.get(key);
    if (!r) {
      const s = id ? sources.get(id) : undefined;
      r = { key, name: id ? (s?.name ?? "Unknown source") : "No referral source", type: s?.type ?? null, realtorId: s?.realtorId ?? null, leads: 0, leadsConverted: 0, ...emptyTotals() };
      rows.set(key, r);
    }
    return r;
  };
  for (const f of facts) add(row(f.referralSourceId), f);
  for (const l of leads) {
    const r = row(l.referralSourceId);
    r.leads++;
    if (l.converted) r.leadsConverted++;
  }
  return [...rows.values()].filter((r) => hasActivity(r) || r.leads > 0).sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : byRevenue(a, b) || b.leads - a.leads));
}

// --------------------------------------------------------------------- by realtor

export interface RealtorRow extends Totals {
  key: string; // realtor id
  name: string;
  brokerage: string | null; // where they work now
  referrals: number; // transactions started in the period they referred
  referralRevenue: Prisma.Decimal;
}

export function byRealtor(
  facts: TransactionFacts[],
  realtors: Map<string, { name: string; brokerage: string | null }>,
  // referral source id → the Realtor it belongs to
  sourceRealtor: Map<string, string>
): { rows: RealtorRow[]; withoutRealtor: Totals } {
  const rows = new Map<string, RealtorRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      const info = realtors.get(id);
      r = { key: id, name: info?.name ?? "Unknown Realtor", brokerage: info?.brokerage ?? null, referrals: 0, referralRevenue: ZERO(), ...emptyTotals() };
      rows.set(id, r);
    }
    return r;
  };
  const withoutRealtor = emptyTotals();
  for (const f of facts) {
    const on = new Set(f.realtors.map((r) => r.realtorId));
    if (on.size === 0) add(withoutRealtor, f);
    for (const id of on) add(row(id), f);
    const referrer = f.referralSourceId ? sourceRealtor.get(f.referralSourceId) : undefined;
    if (referrer) {
      const r = row(referrer);
      if (f.startedInPeriod) r.referrals++;
      r.referralRevenue = r.referralRevenue.plus(f.revenue);
    }
  }
  const active = (r: RealtorRow) => hasActivity(r) || r.referrals > 0 || !r.referralRevenue.isZero();
  return { rows: [...rows.values()].filter(active).sort(byRevenue), withoutRealtor };
}

// ------------------------------------------------------------------ by brokerage

export interface BrokerageRow extends Totals {
  key: string; // brokerage id, "name:<recorded name>", or "independent"
  name: string;
  realtors: number; // distinct Realtors from this brokerage on those deals
}

export function byBrokerage(facts: TransactionFacts[], brokerageNames: Map<string, string>): { rows: BrokerageRow[]; withoutRealtor: Totals } {
  const rows = new Map<string, BrokerageRow & { realtorIds: Set<string> }>();
  const withoutRealtor = emptyTotals();
  for (const f of facts) {
    if (f.realtors.length === 0) {
      add(withoutRealtor, f);
      continue;
    }
    // Once per brokerage per transaction, however many of its agents are on it.
    const here = new Map<string, { name: string; realtorIds: string[] }>();
    for (const tr of f.realtors) {
      const recorded = tr.brokerageName?.trim() || null;
      const key = tr.brokerageId ?? (recorded ? `name:${recorded.toLowerCase()}` : "independent");
      const name = tr.brokerageId ? (brokerageNames.get(tr.brokerageId) ?? recorded ?? "Unknown brokerage") : (recorded ?? "No brokerage (independent)");
      const entry = here.get(key) ?? { name, realtorIds: [] };
      entry.realtorIds.push(tr.realtorId);
      here.set(key, entry);
    }
    for (const [key, { name, realtorIds }] of here) {
      let r = rows.get(key);
      if (!r) {
        r = { key, name, realtors: 0, realtorIds: new Set(), ...emptyTotals() };
        rows.set(key, r);
      }
      add(r, f);
      for (const id of realtorIds) r.realtorIds.add(id);
    }
  }
  const list = [...rows.values()]
    .map(({ realtorIds, ...r }) => ({ ...r, realtors: realtorIds.size }))
    .filter(hasActivity)
    .sort((a, b) => (a.key === "independent" ? 1 : b.key === "independent" ? -1 : byRevenue(a, b)));
  return { rows: list, withoutRealtor };
}

// "12.5%" — or "—" when there's nothing to divide by.
export function percent(part: number, whole: number): string {
  if (whole === 0) return "—";
  const p = (part / whole) * 100;
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}
