import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { digitsOnly } from "@/lib/phone";
import { BROKERAGE_PAGE_SIZE, type BrokerageDirectoryParams } from "./directoryParams";

export interface BrokerageDirectoryRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  totalCount: number;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Same rules as the realtor directory: every whitespace-separated term must
// match some field ("greenville realty"), and a term with 3+ digits also
// matches the stored phone digits ("828-555").
function searchCondition(q: string): Prisma.Sql | null {
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 5);
  if (terms.length === 0) return null;
  const perTerm = terms.map((term) => {
    const pattern = `%${escapeLike(term)}%`;
    const fields = [
      Prisma.sql`b."name" ILIKE ${pattern}`,
      Prisma.sql`b."email" ILIKE ${pattern}`,
      Prisma.sql`b."addressLine1" ILIKE ${pattern}`,
      Prisma.sql`b."city" ILIKE ${pattern}`,
      Prisma.sql`b."state" ILIKE ${pattern}`,
      Prisma.sql`b."zip" ILIKE ${pattern}`,
    ];
    const digits = digitsOnly(term);
    if (digits.length >= 3) fields.push(Prisma.sql`b."phone" LIKE ${`%${digits}%`}`);
    return Prisma.sql`(${Prisma.join(fields, " OR ")})`;
  });
  return Prisma.join(perTerm, " AND ");
}

// Case-insensitive, with a stable tiebreak so paging never repeats a row.
function orderByClause(params: BrokerageDirectoryParams): Prisma.Sql {
  const d = Prisma.raw(params.dir === "desc" ? "DESC" : "ASC");
  if (params.sort === "city") return Prisma.sql`LOWER(b."city") ${d} NULLS LAST, LOWER(b."name") ASC, b."id" ASC`;
  return Prisma.sql`LOWER(b."name") ${d}, b."id" ASC`;
}

export function buildBrokerageQuery(params: BrokerageDirectoryParams): Prisma.Sql {
  const conditions = [Prisma.sql`b."archivedAt" IS NULL`];
  const search = searchCondition(params.q);
  if (search) conditions.push(search);
  const offset = (params.page - 1) * BROKERAGE_PAGE_SIZE;
  return Prisma.sql`
    SELECT b."id", b."name", b."phone", b."email", b."addressLine1", b."city", b."state", b."zip",
      (COUNT(*) OVER())::int AS "totalCount"
    FROM "brokerages" b
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY ${orderByClause(params)}
    LIMIT ${BROKERAGE_PAGE_SIZE} OFFSET ${offset}
  `;
}

// One page at a time — the list never loads every brokerage into the browser.
export async function fetchBrokerageDirectory(params: BrokerageDirectoryParams) {
  const rows = await prisma.$queryRaw<BrokerageDirectoryRow[]>(buildBrokerageQuery(params));
  return { rows, total: rows[0]?.totalCount ?? 0 };
}
