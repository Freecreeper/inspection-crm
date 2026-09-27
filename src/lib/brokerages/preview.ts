import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { realtorDisplayName } from "@/lib/realtors/display";
import { formatBrokerageAddress } from "./directoryParams";

export const PREVIEW_REALTOR_LIMIT = 5;

export interface BrokeragePreview {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  address: string;
  stats: { currentRealtors: number; transactions: number; lastTransactionAt: string | null };
  realtors: { id: string; name: string; phone: string | null; email: string | null }[];
  permissions: { canWrite: boolean };
}

// Everything the drawer shows for one brokerage, fetched only when a row is
// selected. Transactions count deals a realtor worked while at this
// brokerage (the snapshot on TransactionRealtor), so moving a realtor
// elsewhere never rewrites this brokerage's history.
export async function loadBrokeragePreview(id: string, role: Role | undefined): Promise<BrokeragePreview | null> {
  const brokerage = await prisma.brokerage.findFirst({
    where: { id, archivedAt: null },
    select: { id: true, name: true, phone: true, email: true, addressLine1: true, city: true, state: true, zip: true },
  });
  if (!brokerage) return null;

  const dealsHere = { archivedAt: null, realtors: { some: { brokerageId: id } } };
  const [currentRealtors, realtors, transactions, lastTransaction] = await Promise.all([
    prisma.realtor.count({ where: { brokerageId: id, archivedAt: null } }),
    prisma.realtor.findMany({
      where: { brokerageId: id, archivedAt: null },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: PREVIEW_REALTOR_LIMIT,
      select: { id: true, firstName: true, lastName: true, preferredName: true, phone: true, email: true },
    }),
    prisma.transaction.count({ where: dealsHere }),
    prisma.transaction.findFirst({ where: dealsHere, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  return {
    ...brokerage,
    address: formatBrokerageAddress(brokerage),
    stats: { currentRealtors, transactions, lastTransactionAt: lastTransaction?.createdAt.toISOString() ?? null },
    realtors: realtors.map((r) => ({ id: r.id, name: realtorDisplayName(r), phone: r.phone, email: r.email })),
    permissions: { canWrite: can(role, "crm:write") },
  };
}
