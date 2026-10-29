import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Adds a few clearly-marked test realtors (and two test brokerages) for
// trying the Realtors directory, preview and follow-up flows:
//   npx tsx scripts/add-test-realtors.ts
// Emails are @example.com (reserved: they can never reach anyone) and
// phones are fictional 555-01xx numbers. Safe to re-run — anything whose
// email or name already exists is skipped. Created the same way the app
// does it: brokerage history row and an activity-log entry per realtor.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const NOTE = "Test data — safe to delete.";

const BROKERAGES = [
  { name: "Test Realty Group", city: "Hickory", state: "NC", phone: "8285550100", email: "office@testrealty.example.com" },
  { name: "Sample Homes Brokerage", city: "Lenoir", state: "NC", phone: "8285550150", email: "hello@samplehomes.example.com" },
];

const REALTORS = [
  { firstName: "Avery", lastName: "Testwell", email: "avery.testwell@example.com", phone: "8285550101", brokerage: 0, preferredContactMethod: "EMAIL" },
  { firstName: "Jordan", lastName: "Sampleton", email: "jordan.sampleton@example.com", phone: "8285550102", brokerage: 0, preferredContactMethod: "PHONE" },
  { firstName: "Morgan", lastName: "Demo", email: "morgan.demo@example.com", phone: "8285550103", brokerage: 0, preferredContactMethod: "TEXT" },
  { firstName: "Riley", lastName: "Example", email: "riley.example@example.com", phone: "8285550151", brokerage: 1, preferredContactMethod: "EMAIL" },
  { firstName: "Casey", lastName: "Trialson", email: "casey.trialson@example.com", phone: "8285550152", brokerage: 1, preferredContactMethod: "PHONE" },
  { firstName: "Taylor", lastName: "Mockford", email: "taylor.mockford@example.com", phone: "8285550153", brokerage: null, preferredContactMethod: "EMAIL" },
] as const;

async function main() {
  const brokerageIds: string[] = [];
  for (const b of BROKERAGES) {
    const existing = await prisma.brokerage.findFirst({ where: { name: b.name, archivedAt: null }, select: { id: true } });
    if (existing) {
      brokerageIds.push(existing.id);
      console.log(`skip brokerage  ${b.name} (exists)`);
      continue;
    }
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.brokerage.create({ data: b });
      await tx.activityLog.create({ data: { action: "brokerage.created", entityType: "Brokerage", entityId: row.id, after: { ...b, source: "add-test-realtors" } } });
      return row;
    });
    brokerageIds.push(created.id);
    console.log(`added brokerage ${b.name}`);
  }

  for (const r of REALTORS) {
    const existing = await prisma.realtor.findFirst({ where: { email: r.email }, select: { id: true } });
    if (existing) {
      console.log(`skip realtor    ${r.firstName} ${r.lastName} (exists)`);
      continue;
    }
    const brokerageId = r.brokerage === null ? null : brokerageIds[r.brokerage];
    await prisma.$transaction(async (tx) => {
      const created = await tx.realtor.create({
        data: { firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone, preferredContactMethod: r.preferredContactMethod, brokerageId, notes: NOTE },
      });
      if (brokerageId) await tx.realtorBrokerageHistory.create({ data: { realtorId: created.id, brokerageId, startDate: created.createdAt } });
      await tx.activityLog.create({
        data: { action: "realtor.created", entityType: "Realtor", entityId: created.id, after: { firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone, brokerageId, source: "add-test-realtors" } },
      });
    });
    console.log(`added realtor   ${r.firstName} ${r.lastName} <${r.email}>`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
