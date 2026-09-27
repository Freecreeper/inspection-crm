import { Prisma, type PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export interface ScheduleConflict {
  kind: "inspection" | "block";
  id: string;
  title: string;
  start: Date;
  end: Date;
}

// Two intervals overlap when each starts before the other ends; touching
// ends (12:00 end, 12:00 start) is not a conflict.
export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// Everything already on this inspector's calendar that overlaps the
// proposed window: their active inspections (end = start + duration,
// computed in the database) and their blocked time. The server runs this
// for every schedule/reschedule; the client's pre-check is only a preview.
export async function findInspectorConflicts(
  db: Db,
  args: { inspectorId: string; start: Date; end: Date; excludeInspectionId?: string | null }
): Promise<ScheduleConflict[]> {
  const exclude = args.excludeInspectionId ?? "";
  const [inspections, blocks] = await Promise.all([
    db.$queryRaw<{ id: string; scheduledAt: Date; durationMinutes: number; addressLine1: string; city: string }[]>(Prisma.sql`
      SELECT i."id", i."scheduledAt", i."durationMinutes", p."addressLine1", p."city"
      FROM "inspections" i
      JOIN "properties" p ON p."id" = i."propertyId"
      WHERE i."inspectorId" = ${args.inspectorId}
        AND i."status" IN ('SCHEDULED', 'IN_PROGRESS')
        AND i."scheduledAt" IS NOT NULL
        AND i."id" <> ${exclude}
        AND i."scheduledAt" < ${args.end}
        AND i."scheduledAt" + (i."durationMinutes" * INTERVAL '1 minute') > ${args.start}
      ORDER BY i."scheduledAt" ASC
    `),
    db.appointment.findMany({
      where: { kind: "BLOCK", userId: args.inspectorId, cancelledAt: null, startAt: { lt: args.end }, endAt: { gt: args.start } },
      orderBy: { startAt: "asc" },
      select: { id: true, title: true, startAt: true, endAt: true },
    }),
  ]);

  return [
    ...inspections.map((i) => ({
      kind: "inspection" as const,
      id: i.id,
      title: `${i.addressLine1}, ${i.city}`,
      start: i.scheduledAt,
      end: new Date(i.scheduledAt.getTime() + i.durationMinutes * 60_000),
    })),
    ...blocks.map((b) => ({ kind: "block" as const, id: b.id, title: b.title, start: b.startAt, end: b.endAt })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());
}

// Serializes scheduling for one inspector for the rest of the database
// transaction, so two people booking the same slot at the same moment
// can't both pass the conflict check. Released automatically at commit.
export async function lockInspectorSchedule(tx: Prisma.TransactionClient, inspectorId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inspector-schedule:${inspectorId}`}))`;
}
