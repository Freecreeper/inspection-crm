import type { EmailSettings, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

export async function getEmailSettings(db: Db = prisma): Promise<EmailSettings> {
  return (
    (await db.emailSettings.findUnique({ where: { id: "default" } })) ??
    (await db.emailSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } }))
  );
}
