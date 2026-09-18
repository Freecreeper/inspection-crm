import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const adminPasswordHash = await bcrypt.hash("changeme123", 10);
  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      name: "Admin Owner",
      passwordHash: adminPasswordHash,
      role: "OWNER_ADMIN",
    },
  });

  const inspectorPasswordHash = await bcrypt.hash("changeme123", 10);
  await prisma.user.upsert({
    where: { email: "inspector@example.com" },
    update: {},
    create: {
      email: "inspector@example.com",
      name: "Jordan Inspector",
      passwordHash: inspectorPasswordHash,
      role: "INSPECTOR",
    },
  });

  // Company-configurable classification terminology (§ "Finding classification") —
  // a starting set, not a fixed severity scale.
  const categories = [
    { key: "INFORMATIONAL", label: "Informational", displayOrder: 0 },
    { key: "MAINTENANCE", label: "Maintenance", displayOrder: 1 },
    { key: "MONITOR", label: "Monitor", displayOrder: 2 },
    { key: "REPAIR_RECOMMENDED", label: "Repair Recommended", displayOrder: 3 },
    { key: "FURTHER_EVALUATION", label: "Further Evaluation", displayOrder: 4 },
    { key: "SAFETY_CONCERN", label: "Safety Concern", displayOrder: 5 },
  ];
  for (const c of categories) {
    await prisma.findingCategory.upsert({ where: { key: c.key }, update: {}, create: c });
  }

  const services = [
    { name: "General Home Inspection", basePrice: "450.00" },
    { name: "Radon Test", basePrice: "150.00" },
    { name: "Termite / WDI Inspection", basePrice: "95.00" },
  ];
  for (const s of services) {
    const existing = await prisma.service.findFirst({ where: { name: s.name } });
    if (!existing) await prisma.service.create({ data: s });
  }

  const referralSources = [
    { name: "Realtor referral", type: "Realtor" },
    { name: "Past customer", type: "Past Customer" },
    { name: "Google / Online search", type: "Online" },
  ];
  for (const r of referralSources) {
    const existing = await prisma.referralSource.findFirst({ where: { name: r.name } });
    if (!existing) await prisma.referralSource.create({ data: r });
  }

  // Placeholder template (§10, §28) — replace with the business's real
  // inspection checklist before relying on this for actual reports.
  const existingTemplate = await prisma.reportTemplate.findFirst({
    where: { name: "Standard Residential Inspection (placeholder)" },
  });
  if (!existingTemplate) {
    await prisma.reportTemplate.create({
      data: {
        name: "Standard Residential Inspection (placeholder)",
        description: "Example structure from the architecture proposal — not the business's real checklist yet.",
        sections: {
          create: [
            {
              name: "Roofing",
              displayOrder: 0,
              components: { create: [{ name: "Roof Covering", displayOrder: 0 }, { name: "Flashing", displayOrder: 1 }] },
            },
            {
              name: "Electrical",
              displayOrder: 1,
              components: {
                create: [
                  { name: "Service Entrance", displayOrder: 0 },
                  { name: "Main Panel", displayOrder: 1 },
                  { name: "GFCI Protection", displayOrder: 2 },
                ],
              },
            },
            {
              name: "Plumbing",
              displayOrder: 2,
              components: { create: [{ name: "Water Heater", displayOrder: 0 }, { name: "Fixtures", displayOrder: 1 }] },
            },
          ],
        },
      },
    });
  }

  console.log("Seed complete: admin@example.com / inspector@example.com, password 'changeme123'.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
