import { Prisma, type PrismaClient, type Realtor } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { realtorDisplayName } from "@/lib/realtors/display";
import { getEmailConfig } from "../config";
import { enqueueEmail } from "../queue";
import { getAutomation, logAutomationEvent } from "./registry";

type Db = PrismaClient | Prisma.TransactionClient;

// The calendar date (in the company's time zone) that is `daysAhead` days
// after `now`.
export function targetCalendarDate(now: Date, daysAhead: number, timeZone = getEmailConfig().timeZone) {
  const shifted = new Date(now.getTime() + daysAhead * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(shifted);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// Month/day pairs that "fall on" the target date. Feb 29 dates are
// celebrated on Feb 28 in non-leap years rather than skipped.
export function matchingMonthDays(target: { year: number; month: number; day: number }) {
  const pairs = [{ month: target.month, day: target.day }];
  if (target.month === 2 && target.day === 28 && !isLeapYear(target.year)) pairs.push({ month: 2, day: 29 });
  return pairs;
}

async function prepare(
  realtor: Pick<Realtor, "id" | "firstName" | "lastName" | "preferredName" | "email">,
  args: {
    automationId: string;
    sendMode: "AUTOMATIC" | "REVIEW" | "MANUAL";
    templateKey: string;
    key: string;
    entityResult: string;
    // The occasion's own date: "years since" values are computed as of the
    // anniversary itself, not the (possibly earlier) day it's prepared.
    occasionDate?: Date;
  },
  db: Db
) {
  const draft = args.sendMode !== "AUTOMATIC";
  const result = await enqueueEmail(
    {
      mode: draft ? "REVIEW" : "AUTOMATIC",
      draft,
      templateKey: args.templateKey,
      recipient: { type: "REALTOR", name: realtorDisplayName(realtor), email: realtor.email },
      refs: { realtorId: realtor.id },
      automationId: args.automationId,
      idempotencyKey: args.key,
      now: args.occasionDate,
    },
    db
  );
  if (result.created) {
    await logAutomationEvent(
      args.automationId,
      {
        entityType: "Realtor",
        entityId: realtor.id,
        result: result.message.status === "DRAFT" ? "PREPARED" : result.message.status,
        detail: { emailMessageId: result.message.id, recipient: result.message.recipientName, occasion: args.entityResult, reason: result.message.statusReason },
      },
      db
    );
  }
  return result;
}

// Realtors whose birthday falls on the target date. Realtors with no
// birthday on file are simply never matched — nothing is assumed.
export async function sweepRealtorBirthdays(now: Date, db: Db = prisma) {
  const auto = await getAutomation("realtor_birthday", db);
  if (!auto.active) return [];
  const target = targetCalendarDate(now, auto.config.daysBefore);
  const realtors = await db.realtor.findMany({
    where: { archivedAt: null, OR: matchingMonthDays(target).map((p) => ({ birthdayMonth: p.month, birthdayDay: p.day })) },
    select: { id: true, firstName: true, lastName: true, preferredName: true, email: true },
  });
  const results = [];
  for (const realtor of realtors) {
    results.push(
      await prepare(
        realtor,
        { automationId: auto.row.id, sendMode: auto.sendMode, templateKey: auto.config.templateKey, key: `birthday:${realtor.id}:${target.year}`, entityResult: "birthday" },
        db
      )
    );
  }
  return results;
}

async function realtorsWithAnniversary(column: "careerStartDate" | "relationshipStartDate", target: { year: number; month: number; day: number }, db: Db) {
  const pairs = matchingMonthDays(target);
  const col = Prisma.raw(`"${column}"`);
  const conditions = pairs.map(
    (p) => Prisma.sql`(EXTRACT(MONTH FROM ${col}) = ${p.month} AND EXTRACT(DAY FROM ${col}) = ${p.day})`
  );
  // At least one full year — no "0 years" anniversary on the start date.
  return db.$queryRaw<{ id: string; firstName: string; lastName: string; preferredName: string | null; email: string | null }[]>(Prisma.sql`
    SELECT "id", "firstName", "lastName", "preferredName", "email" FROM "realtors"
    WHERE "archivedAt" IS NULL AND ${col} IS NOT NULL
      AND EXTRACT(YEAR FROM ${col}) < ${target.year}
      AND (${Prisma.join(conditions, " OR ")})
  `);
}

export async function sweepRealtorAnniversaries(now: Date, db: Db = prisma) {
  const auto = await getAutomation("realtor_anniversary", db);
  if (!auto.active) return [];
  const target = targetCalendarDate(now, auto.config.daysBefore);
  const occasionDate = new Date(Date.UTC(target.year, target.month - 1, target.day, 12));
  const results = [];
  if (auto.config.career) {
    for (const realtor of await realtorsWithAnniversary("careerStartDate", target, db)) {
      results.push(
        await prepare(
          realtor,
          {
            automationId: auto.row.id,
            sendMode: auto.sendMode,
            templateKey: auto.config.careerTemplateKey,
            key: `career-anniversary:${realtor.id}:${target.year}`,
            entityResult: "career anniversary",
            occasionDate,
          },
          db
        )
      );
    }
  }
  if (auto.config.relationship) {
    for (const realtor of await realtorsWithAnniversary("relationshipStartDate", target, db)) {
      results.push(
        await prepare(
          realtor,
          {
            automationId: auto.row.id,
            sendMode: auto.sendMode,
            templateKey: auto.config.relationshipTemplateKey,
            key: `relationship-anniversary:${realtor.id}:${target.year}`,
            entityResult: "working-together anniversary",
            occasionDate,
          },
          db
        )
      );
    }
  }
  return results;
}
