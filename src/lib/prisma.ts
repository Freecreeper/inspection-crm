import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires a driver adapter at runtime (§17) — the connection string
// itself is read once here rather than embedded in the generated schema.
// Every DateTime column is TIMESTAMP without time zone holding UTC. Pinning
// the session to UTC keeps any raw SQL that touches now()/CURRENT_DATE
// consistent with what Prisma writes, whatever the server's default is.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, options: "-c TimeZone=UTC" });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
