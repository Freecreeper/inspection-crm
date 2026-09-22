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

  // The Reporting Query Service's allow-list (§9, src/lib/reporting.ts) —
  // every field the Custom Report Builder can touch has to exist here first.
  // joinPath null = the entity's own field; joinPath set = a related
  // entity's field, reachable as "<joinPath>.<fieldKey>" in the UI.
  const catalogEntries: {
    entity: string;
    fieldKey: string;
    label: string;
    dataType: string;
    aggregable?: boolean;
    joinPath?: string;
  }[] = [
    { entity: "Lead", fieldKey: "id", label: "Lead count", dataType: "string", aggregable: true },
    { entity: "Lead", fieldKey: "status", label: "Status", dataType: "string" },
    { entity: "Lead", fieldKey: "referralSourceId", label: "Referral source", dataType: "string" },
    { entity: "Lead", fieldKey: "createdAt", label: "Created", dataType: "date" },

    { entity: "Customer", fieldKey: "id", label: "Customer count", dataType: "string", aggregable: true },
    { entity: "Customer", fieldKey: "firstName", label: "First name", dataType: "string" },
    { entity: "Customer", fieldKey: "lastName", label: "Last name", dataType: "string" },
    { entity: "Customer", fieldKey: "createdAt", label: "Created", dataType: "date" },

    { entity: "Transaction", fieldKey: "id", label: "Transaction count", dataType: "string", aggregable: true },
    { entity: "Transaction", fieldKey: "status", label: "Status", dataType: "string" },
    { entity: "Transaction", fieldKey: "referralSourceId", label: "Referral source", dataType: "string" },
    { entity: "Transaction", fieldKey: "createdAt", label: "Created", dataType: "date" },
    { entity: "Transaction", fieldKey: "closingDate", label: "Closing date", dataType: "date" },
    { entity: "Transaction", fieldKey: "city", label: "Property city", dataType: "string", joinPath: "property" },
    { entity: "Transaction", fieldKey: "zip", label: "Property ZIP", dataType: "string", joinPath: "property" },
    { entity: "Transaction", fieldKey: "name", label: "Referral source name", dataType: "string", joinPath: "referralSource" },

    { entity: "Property", fieldKey: "id", label: "Property count", dataType: "string", aggregable: true },
    { entity: "Property", fieldKey: "city", label: "City", dataType: "string" },
    { entity: "Property", fieldKey: "zip", label: "ZIP", dataType: "string" },
    { entity: "Property", fieldKey: "state", label: "State", dataType: "string" },
    { entity: "Property", fieldKey: "yearBuilt", label: "Year built", dataType: "number", aggregable: true },
    { entity: "Property", fieldKey: "squareFootage", label: "Square footage", dataType: "number", aggregable: true },

    { entity: "Realtor", fieldKey: "id", label: "Realtor count", dataType: "string", aggregable: true },
    { entity: "Realtor", fieldKey: "firstName", label: "First name", dataType: "string" },
    { entity: "Realtor", fieldKey: "lastName", label: "Last name", dataType: "string" },
    { entity: "Realtor", fieldKey: "brokerageId", label: "Brokerage", dataType: "string" },
    { entity: "Realtor", fieldKey: "name", label: "Brokerage name", dataType: "string", joinPath: "brokerage" },

    { entity: "Brokerage", fieldKey: "id", label: "Brokerage count", dataType: "string", aggregable: true },
    { entity: "Brokerage", fieldKey: "name", label: "Name", dataType: "string" },
    { entity: "Brokerage", fieldKey: "city", label: "City", dataType: "string" },

    { entity: "ReferralSource", fieldKey: "id", label: "Referral source count", dataType: "string", aggregable: true },
    { entity: "ReferralSource", fieldKey: "name", label: "Name", dataType: "string" },
    { entity: "ReferralSource", fieldKey: "type", label: "Type", dataType: "string" },
    { entity: "ReferralSource", fieldKey: "active", label: "Active", dataType: "boolean" },

    { entity: "Inspection", fieldKey: "id", label: "Inspection count", dataType: "string", aggregable: true },
    { entity: "Inspection", fieldKey: "status", label: "Status", dataType: "string" },
    { entity: "Inspection", fieldKey: "scheduledAt", label: "Scheduled", dataType: "date" },
    { entity: "Inspection", fieldKey: "inspectorId", label: "Inspector", dataType: "string" },
    { entity: "Inspection", fieldKey: "city", label: "Property city", dataType: "string", joinPath: "property" },
    { entity: "Inspection", fieldKey: "zip", label: "Property ZIP", dataType: "string", joinPath: "property" },
    { entity: "Inspection", fieldKey: "name", label: "Inspector name", dataType: "string", joinPath: "inspector" },

    { entity: "Finding", fieldKey: "id", label: "Finding count", dataType: "string", aggregable: true },
    { entity: "Finding", fieldKey: "categoryId", label: "Category", dataType: "string" },
    { entity: "Finding", fieldKey: "safetyRelated", label: "Safety related", dataType: "boolean" },
    { entity: "Finding", fieldKey: "repairRecommended", label: "Repair recommended", dataType: "boolean" },
    { entity: "Finding", fieldKey: "monitor", label: "Monitor", dataType: "boolean" },
    { entity: "Finding", fieldKey: "furtherEvaluation", label: "Further evaluation", dataType: "boolean" },
    { entity: "Finding", fieldKey: "includedInSummary", label: "Included in summary", dataType: "boolean" },
    { entity: "Finding", fieldKey: "label", label: "Category label", dataType: "string", joinPath: "category" },
  ];
  for (const entry of catalogEntries) {
    // The unique constraint is on the *stored* (entity, fieldKey) — fieldKey
    // is always the leaf name (e.g. "city"), never the "joinPath.fieldKey"
    // public key the reporting service builds at query time. Matching on
    // the wrong shape here would make this upsert always take the create
    // branch and violate that same constraint on a second seed run.
    await prisma.reportFieldCatalogEntry.upsert({
      where: { entity_fieldKey: { entity: entry.entity, fieldKey: entry.fieldKey } },
      update: {},
      create: {
        entity: entry.entity,
        fieldKey: entry.fieldKey,
        label: entry.label,
        dataType: entry.dataType,
        aggregable: entry.aggregable ?? false,
        joinPath: entry.joinPath ?? null,
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
