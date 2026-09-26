import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { digitsOnly } from "@/lib/phone";

export type DuplicateReason = "email" | "phone" | "nameBrokerage";

export interface DuplicateCandidate {
  id: string;
  name: string;
  brokerageName: string | null;
  email: string | null;
  phone: string | null;
  reasons: DuplicateReason[];
  // Email/phone matches are near-certain; name+brokerage is only probable.
  exact: boolean;
}

export interface DuplicateProbe {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  brokerageId?: string | null;
}

type CandidateRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  brokerageId: string | null;
  brokerage: { name: string } | null;
};

export function classifyDuplicate(probe: DuplicateProbe, row: CandidateRow): DuplicateReason[] {
  const reasons: DuplicateReason[] = [];
  const email = probe.email?.trim().toLowerCase();
  if (email && row.email?.toLowerCase() === email) reasons.push("email");
  const phone = probe.phone ? digitsOnly(probe.phone) : "";
  if (phone && row.phone && digitsOnly(row.phone) === phone) reasons.push("phone");
  const sameName =
    row.firstName.toLowerCase() === probe.firstName.trim().toLowerCase() &&
    row.lastName.toLowerCase() === probe.lastName.trim().toLowerCase();
  if (sameName && (row.brokerageId ?? null) === (probe.brokerageId || null)) reasons.push("nameBrokerage");
  return reasons;
}

// Surfaces possible matches for a human to review — never merges anything.
export async function findRealtorDuplicates(probe: DuplicateProbe): Promise<DuplicateCandidate[]> {
  const or: Prisma.RealtorWhereInput[] = [];
  const email = probe.email?.trim();
  if (email) or.push({ email: { equals: email, mode: "insensitive" } });
  const phone = probe.phone ? digitsOnly(probe.phone) : "";
  if (phone) or.push({ phone });
  if (probe.firstName.trim() && probe.lastName.trim()) {
    or.push({
      firstName: { equals: probe.firstName.trim(), mode: "insensitive" },
      lastName: { equals: probe.lastName.trim(), mode: "insensitive" },
      brokerageId: probe.brokerageId || null,
    });
  }
  if (or.length === 0) return [];

  const rows = await prisma.realtor.findMany({
    where: { archivedAt: null, OR: or },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, brokerageId: true, brokerage: { select: { name: true } } },
    take: 10,
  });

  return rows
    .map((row) => {
      const reasons = classifyDuplicate(probe, row);
      return {
        id: row.id,
        name: `${row.firstName} ${row.lastName}`,
        brokerageName: row.brokerage?.name ?? null,
        email: row.email,
        phone: row.phone,
        reasons,
        exact: reasons.includes("email") || reasons.includes("phone"),
      };
    })
    .filter((c) => c.reasons.length > 0)
    .sort((a, b) => Number(b.exact) - Number(a.exact));
}
