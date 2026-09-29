import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { searchCustomers, searchRealtors } from "@/lib/scheduling/records";
import { getCalendarConfig } from "@/lib/calendar/config";
import { formatDay, formatTime, toDayKey } from "@/lib/calendar/time";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, SEARCH_KIND_PERMISSIONS, SEARCH_KINDS, type GlobalSearchResult, type SearchKind } from "./kinds";

export * from "./kinds";

// Global record search (Dashboard header). Server-backed: each keystroke
// (debounced in the browser) runs a few small, limited queries — the
// browser never receives a record list to filter itself. Each result kind
// names the permission it needs, so narrowing access to a record type later
// narrows search with it.

export const PER_KIND_LIMIT = 5;

function terms(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean).slice(0, 5);
}

const ci = (w: string) => ({ contains: w, mode: "insensitive" as const });
const propertyMatch = (w: string): Prisma.PropertyWhereInput => ({ OR: [{ addressLine1: ci(w) }, { city: ci(w) }, { zip: { startsWith: w } }] });
const addr = (p: { addressLine1: string; city: string } | null | undefined) => (p ? `${p.addressLine1}, ${p.city}` : null);

const SEARCHERS: Record<SearchKind, (q: string) => Promise<GlobalSearchResult[]>> = {
  customer: async (q) =>
    (await searchCustomers(q)).slice(0, PER_KIND_LIMIT).map((c) => ({ kind: "customer", id: c.id, label: c.label, sublabel: c.sublabel ?? null, href: `/customers/${c.id}` })),

  realtor: async (q) =>
    (await searchRealtors(q)).slice(0, PER_KIND_LIMIT).map((r) => ({ kind: "realtor", id: r.id, label: r.label, sublabel: r.sublabel ?? null, href: `/realtors/${r.id}` })),

  brokerage: async (q) => {
    const rows = await prisma.brokerage.findMany({
      where: { archivedAt: null, AND: terms(q).map((w) => ({ OR: [{ name: ci(w) }, { city: ci(w) }] })) },
      orderBy: { name: "asc" },
      take: PER_KIND_LIMIT,
      select: { id: true, name: true, city: true },
    });
    return rows.map((b) => ({ kind: "brokerage", id: b.id, label: b.name, sublabel: b.city, href: `/brokerages/${b.id}` }));
  },

  // Properties have no page of their own; open the latest transaction.
  property: async (q) => {
    const rows = await prisma.property.findMany({
      where: { AND: terms(q).map(propertyMatch) },
      orderBy: { addressLine1: "asc" },
      take: PER_KIND_LIMIT,
      select: { id: true, addressLine1: true, city: true, state: true, zip: true, transactions: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return rows.map((p) => ({
      kind: "property",
      id: p.id,
      label: p.addressLine1,
      sublabel: `${p.city}, ${p.state} ${p.zip}`,
      href: p.transactions[0] ? `/transactions/${p.transactions[0].id}` : "/properties",
    }));
  },

  transaction: async (q) => {
    const rows = await prisma.transaction.findMany({
      where: {
        archivedAt: null,
        AND: terms(q).map((w) => ({
          OR: [{ property: propertyMatch(w) }, { customers: { some: { customer: { OR: [{ firstName: ci(w) }, { lastName: ci(w) }] } } } }],
        })),
      },
      orderBy: { createdAt: "desc" },
      take: PER_KIND_LIMIT,
      select: {
        id: true,
        status: true,
        property: { select: { addressLine1: true, city: true } },
        customers: { select: { primaryContact: true, customer: { select: { firstName: true, lastName: true } } } },
      },
    });
    return rows.map((t) => {
      const c = (t.customers.find((r) => r.primaryContact) ?? t.customers[0])?.customer;
      return {
        kind: "transaction",
        id: t.id,
        label: addr(t.property) ?? (c ? `${c.firstName} ${c.lastName}` : "Transaction"),
        sublabel: [c && t.property ? `${c.firstName} ${c.lastName}` : null, t.status.toLowerCase().replace(/_/g, " ")].filter(Boolean).join(" · "),
        href: `/transactions/${t.id}`,
      };
    });
  },

  inspection: async (q) => {
    const rows = await prisma.inspection.findMany({
      where: { AND: terms(q).map((w) => ({ property: propertyMatch(w) })) },
      orderBy: { scheduledAt: "desc" },
      take: PER_KIND_LIMIT,
      select: { id: true, status: true, scheduledAt: true, property: { select: { addressLine1: true, city: true } } },
    });
    const { timeZone } = getCalendarConfig();
    return rows.map((i) => ({
      kind: "inspection",
      id: i.id,
      label: addr(i.property) ?? "Inspection",
      sublabel: [i.status.toLowerCase().replace(/_/g, " "), i.scheduledAt ? `${formatDay(toDayKey(i.scheduledAt, timeZone), "short")}, ${formatTime(i.scheduledAt, timeZone)}` : "not scheduled"].filter(Boolean).join(" · "),
      href: `/inspections/${i.id}`,
    }));
  },
};

export function searchableKinds(role: Role | null | undefined): SearchKind[] {
  return SEARCH_KINDS.filter((k) => SEARCH_KIND_PERMISSIONS[k].every((p) => can(role, p)));
}

export async function globalSearch(query: string, role: Role | null | undefined): Promise<GlobalSearchResult[]> {
  const q = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (q.length < MIN_QUERY_LENGTH) return [];
  const kinds = searchableKinds(role);
  const results = await Promise.all(kinds.map((k) => SEARCHERS[k](q)));
  return results.flat();
}
