import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { digitsOnly, formatPhone } from "@/lib/phone";
import { realtorDisplayName } from "@/lib/realtors/display";

// Server-backed typeahead and duplicate protection for scheduling. Search
// returns a handful of matches per keystroke — the browser never receives
// the whole customer or property list.

export const SEARCH_LIMIT = 10;

export interface SearchOption {
  id: string;
  label: string;
  sublabel?: string;
}

function terms(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean).slice(0, 5);
}

// Every term must match some field ("john 828" finds John with an 828 number).
export async function searchCustomers(q: string): Promise<SearchOption[]> {
  const words = terms(q);
  if (words.length === 0) return [];
  const rows = await prisma.customer.findMany({
    where: {
      archivedAt: null,
      AND: words.map((w) => {
        const digits = digitsOnly(w);
        const or: Prisma.CustomerWhereInput[] = [
          { firstName: { contains: w, mode: "insensitive" } },
          { lastName: { contains: w, mode: "insensitive" } },
          { email: { contains: w, mode: "insensitive" } },
        ];
        if (digits.length >= 3) or.push({ phone: { contains: digits } });
        return { OR: or };
      }),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: SEARCH_LIMIT,
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  });
  return rows.map((c) => ({
    id: c.id,
    label: `${c.firstName} ${c.lastName}`,
    sublabel: [c.phone ? formatPhone(c.phone) : null, c.email].filter(Boolean).join(" · ") || "No contact info",
  }));
}

export async function searchProperties(q: string): Promise<SearchOption[]> {
  const words = terms(q);
  if (words.length === 0) return [];
  const rows = await prisma.property.findMany({
    where: {
      AND: words.map((w) => ({
        OR: [
          { addressLine1: { contains: w, mode: "insensitive" as const } },
          { city: { contains: w, mode: "insensitive" as const } },
          { zip: { startsWith: w } },
        ],
      })),
    },
    orderBy: [{ addressLine1: "asc" }],
    take: SEARCH_LIMIT,
    select: { id: true, addressLine1: true, addressLine2: true, city: true, state: true, zip: true },
  });
  return rows.map((p) => ({ id: p.id, label: [p.addressLine1, p.addressLine2].filter(Boolean).join(" "), sublabel: `${p.city}, ${p.state} ${p.zip}` }));
}

export async function searchRealtors(q: string): Promise<SearchOption[]> {
  const words = terms(q);
  if (words.length === 0) return [];
  const rows = await prisma.realtor.findMany({
    where: {
      archivedAt: null,
      AND: words.map((w) => ({
        OR: [
          { firstName: { contains: w, mode: "insensitive" as const } },
          { lastName: { contains: w, mode: "insensitive" as const } },
          { preferredName: { contains: w, mode: "insensitive" as const } },
          { brokerage: { name: { contains: w, mode: "insensitive" as const } } },
        ],
      })),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: SEARCH_LIMIT,
    select: { id: true, firstName: true, lastName: true, preferredName: true, brokerage: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, label: realtorDisplayName(r), sublabel: r.brokerage?.name ?? "No brokerage" }));
}

// ---------------------------------------------------------------------------
// Duplicate protection — surfaces candidates for a person to review. Nothing
// is ever merged or silently reused.
// ---------------------------------------------------------------------------

export type CustomerDuplicateReason = "email" | "phone" | "name";

export interface CustomerDuplicate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  reasons: CustomerDuplicateReason[];
  exact: boolean;
}

export async function findCustomerDuplicates(probe: { firstName: string; lastName: string; email?: string | null; phone?: string | null }): Promise<CustomerDuplicate[]> {
  const email = probe.email?.trim().toLowerCase() || null;
  const phone = probe.phone ? digitsOnly(probe.phone) : "";
  const or: Prisma.CustomerWhereInput[] = [
    { firstName: { equals: probe.firstName.trim(), mode: "insensitive" }, lastName: { equals: probe.lastName.trim(), mode: "insensitive" } },
  ];
  if (email) or.push({ email: { equals: email, mode: "insensitive" } });
  // Older rows may store formatted numbers; narrow by the last four digits,
  // then compare exactly below.
  if (phone.length === 10) or.push({ phone: { contains: phone.slice(-4) } });

  const rows = await prisma.customer.findMany({
    where: { archivedAt: null, OR: or },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    take: 25,
  });
  return rows
    .map((c) => {
      const reasons: CustomerDuplicateReason[] = [];
      if (email && c.email?.toLowerCase() === email) reasons.push("email");
      if (phone && c.phone && digitsOnly(c.phone) === phone) reasons.push("phone");
      if (c.firstName.toLowerCase() === probe.firstName.trim().toLowerCase() && c.lastName.toLowerCase() === probe.lastName.trim().toLowerCase()) {
        reasons.push("name");
      }
      return { id: c.id, name: `${c.firstName} ${c.lastName}`, email: c.email, phone: c.phone, reasons, exact: reasons.includes("email") || reasons.includes("phone") };
    })
    .filter((c) => c.reasons.length > 0)
    .sort((a, b) => Number(b.exact) - Number(a.exact))
    .slice(0, 5);
}

const STREET_WORDS: Record<string, string> = {
  street: "st", avenue: "ave", av: "ave", road: "rd", drive: "dr", lane: "ln", court: "ct", boulevard: "blvd", place: "pl",
  terrace: "ter", circle: "cir", highway: "hwy", parkway: "pkwy", trail: "trl", way: "wy", square: "sq",
  north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
  apartment: "apt", suite: "ste", unit: "unit",
};

// "123 N. Main Street, Apt 4" and "123 north main st apt 4" normalize alike.
export function normalizeStreet(line: string): string {
  return line
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] ?? w)
    .join(" ");
}

export interface PropertyDuplicate {
  id: string;
  label: string;
  sublabel: string;
}

export async function findPropertyDuplicates(probe: { addressLine1: string; addressLine2?: string | null; city: string; zip: string }): Promise<PropertyDuplicate[]> {
  const street = normalizeStreet([probe.addressLine1, probe.addressLine2].filter(Boolean).join(" "));
  const zip5 = probe.zip.trim().slice(0, 5);
  const candidates = await prisma.property.findMany({
    where: { OR: [...(zip5 ? [{ zip: { startsWith: zip5 } }] : []), { city: { equals: probe.city.trim(), mode: "insensitive" } }] },
    select: { id: true, addressLine1: true, addressLine2: true, city: true, state: true, zip: true },
    take: 500,
  });
  return candidates
    .filter((p) => normalizeStreet([p.addressLine1, p.addressLine2].filter(Boolean).join(" ")) === street)
    .slice(0, 5)
    .map((p) => ({ id: p.id, label: [p.addressLine1, p.addressLine2].filter(Boolean).join(" "), sublabel: `${p.city}, ${p.state} ${p.zip}` }));
}
