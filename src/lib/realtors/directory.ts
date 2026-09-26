import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, startOfDay } from "@/lib/dates";
import { digitsOnly } from "@/lib/phone";
import { DIRECTORY_PAGE_SIZE, type DirectoryParams, type DirectorySort } from "./directoryParams";

export interface DirectoryRow {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  brokerageId: string | null;
  brokerageName: string | null;
  transactionCount: number;
  referralCount: number;
  lastActivityAt: Date | null;
  nextFollowUpAt: Date | null;
  openTaskCount: number;
  totalCount: number;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Every whitespace-separated term must match at least one searchable field,
// so "sarah keller" finds Sarah at Keller Williams.
function searchCondition(q: string): Prisma.Sql | null {
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 5);
  if (terms.length === 0) return null;
  const perTerm = terms.map((term) => {
    const pattern = `%${escapeLike(term)}%`;
    const fields = [
      Prisma.sql`r."firstName" ILIKE ${pattern}`,
      Prisma.sql`r."lastName" ILIKE ${pattern}`,
      Prisma.sql`r."preferredName" ILIKE ${pattern}`,
      Prisma.sql`r."email" ILIKE ${pattern}`,
      Prisma.sql`b."name" ILIKE ${pattern}`,
    ];
    // Phones are stored as bare digits, so "828-555" should match too.
    const digits = digitsOnly(term);
    if (digits.length >= 3) fields.push(Prisma.sql`r."phone" LIKE ${`%${digits}%`}`);
    return Prisma.sql`(${Prisma.join(fields, " OR ")})`;
  });
  return Prisma.join(perTerm, " AND ");
}

function orderByClause(sort: DirectorySort, dir: "asc" | "desc"): Prisma.Sql {
  const d = Prisma.raw(dir === "desc" ? "DESC" : "ASC");
  const tieBreak = Prisma.sql`LOWER(r."lastName") ASC, LOWER(r."firstName") ASC, r."id" ASC`;
  switch (sort) {
    case "brokerage":
      return Prisma.sql`LOWER(b."name") ${d} NULLS LAST, ${tieBreak}`;
    case "lastActivity":
      return Prisma.sql`la."at" ${d} NULLS LAST, ${tieBreak}`;
    case "nextAction":
      // Realtors with an open but undated task sort after dated ones and
      // before realtors with nothing scheduled at all.
      return Prisma.sql`nf."due" ${d} NULLS LAST, (nf."open" > 0) DESC, ${tieBreak}`;
    case "transactions":
      return Prisma.sql`tx."cnt" ${d}, ${tieBreak}`;
    case "referrals":
      return Prisma.sql`rf."cnt" ${d}, ${tieBreak}`;
    default:
      return Prisma.sql`LOWER(r."lastName") ${d}, LOWER(r."firstName") ${d}, r."id" ASC`;
  }
}

// One round trip for a whole page: every per-row aggregate is a LATERAL
// subquery driven by an indexed realtorId lookup, so the cost grows with
// the page (and the filtered set, when sorting by a derived column), never
// with one query per row.
//
// Last activity is the latest of: a communication logged with the realtor,
// a completed realtor task, being added to a transaction, a completed
// inspection on an associated transaction, or a transaction referred by them.
export function buildDirectoryQuery(params: DirectoryParams, now: Date): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`r."archivedAt" IS NULL`];

  const search = searchCondition(params.q);
  if (search) conditions.push(search);
  if (params.brokerageId) conditions.push(Prisma.sql`r."brokerageId" = ${params.brokerageId}`);
  if (params.flags.missingBrokerage) conditions.push(Prisma.sql`r."brokerageId" IS NULL`);
  if (params.flags.missingContact) conditions.push(Prisma.sql`(r."phone" IS NULL OR r."email" IS NULL)`);
  if (params.flags.hasReferrals) conditions.push(Prisma.sql`rf."cnt" > 0`);
  if (params.flags.hasTransactions) conditions.push(Prisma.sql`tx."cnt" > 0`);
  if (params.flags.needsFollowUp) {
    const endOfToday = addDays(startOfDay(now), 1);
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "tasks" tk
      WHERE tk."realtorId" = r."id" AND tk."completedAt" IS NULL AND tk."dueAt" < ${endOfToday}
    )`);
  }
  if (params.activity === "30d") conditions.push(Prisma.sql`la."at" >= ${addDays(now, -30)}`);
  if (params.activity === "90d") conditions.push(Prisma.sql`la."at" >= ${addDays(now, -90)}`);
  if (params.activity === "stale90") conditions.push(Prisma.sql`(la."at" IS NULL OR la."at" < ${addDays(now, -90)})`);

  const offset = (params.page - 1) * DIRECTORY_PAGE_SIZE;

  return Prisma.sql`
    SELECT
      r."id", r."firstName", r."lastName", r."preferredName", r."email", r."phone",
      r."brokerageId", b."name" AS "brokerageName",
      tx."cnt" AS "transactionCount",
      rf."cnt" AS "referralCount",
      la."at" AS "lastActivityAt",
      nf."due" AS "nextFollowUpAt",
      nf."open" AS "openTaskCount",
      (COUNT(*) OVER())::int AS "totalCount"
    FROM "realtors" r
    LEFT JOIN "brokerages" b ON b."id" = r."brokerageId"
    CROSS JOIN LATERAL (
      SELECT COUNT(DISTINCT trr."transactionId")::int AS "cnt"
      FROM "transaction_realtors" trr
      JOIN "transactions" t ON t."id" = trr."transactionId" AND t."archivedAt" IS NULL
      WHERE trr."realtorId" = r."id"
    ) tx
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS "cnt"
      FROM "transactions" t
      JOIN "referral_sources" rs ON rs."id" = t."referralSourceId"
      WHERE rs."realtorId" = r."id" AND t."archivedAt" IS NULL
    ) rf
    CROSS JOIN LATERAL (
      SELECT GREATEST(
        (SELECT MAX(c."occurredAt") FROM "communications" c WHERE c."realtorId" = r."id"),
        (SELECT MAX(tk."completedAt") FROM "tasks" tk WHERE tk."realtorId" = r."id"),
        (SELECT MAX(trr."createdAt") FROM "transaction_realtors" trr WHERE trr."realtorId" = r."id"),
        (SELECT MAX(i."completedAt") FROM "inspections" i
           JOIN "transaction_realtors" trr ON trr."transactionId" = i."transactionId"
           WHERE trr."realtorId" = r."id"),
        (SELECT MAX(t."createdAt") FROM "transactions" t
           JOIN "referral_sources" rs ON rs."id" = t."referralSourceId"
           WHERE rs."realtorId" = r."id")
      ) AS "at"
    ) la
    CROSS JOIN LATERAL (
      SELECT MIN(tk."dueAt") AS "due", COUNT(*)::int AS "open"
      FROM "tasks" tk
      WHERE tk."realtorId" = r."id" AND tk."completedAt" IS NULL
    ) nf
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY ${orderByClause(params.sort, params.dir)}
    LIMIT ${DIRECTORY_PAGE_SIZE} OFFSET ${offset}
  `;
}

export async function fetchDirectoryPage(params: DirectoryParams, now = new Date()) {
  const rows = await prisma.$queryRaw<DirectoryRow[]>(buildDirectoryQuery(params, now));
  return { rows, total: rows[0]?.totalCount ?? 0 };
}
