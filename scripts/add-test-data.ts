import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { createElement } from "react";
import { Document, Page, Text, renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { Prisma, RealtorParticipantRole, ReportStatus, ComponentInspectionStatus, EmailStatus, EmailSendMode, EmailRecipientType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { hashPassword } from "@/lib/security/password";
import { addDays, dayKeyToDateOnly, toDayKey, zonedDateTimeToUtc, type DayKey } from "@/lib/calendar/time";
import { generateReportNumber, syncReportSummary, type ReportSnapshot } from "@/lib/reportEngine";
import { renderReportPdf } from "@/lib/pdf/renderReportPdf";
import { loadEmailVariables, type EmailRefs } from "@/lib/email/context";
import { renderSubjectAndBody } from "@/lib/email/render";
import { onInspectionCompleted, onInspectionScheduled } from "@/lib/email/automations/inspection";

// Fills every area of the CRM with clearly-marked test data — users,
// leads, customers, properties, transactions at every stage, inspections,
// reports (draft through delivered, with findings, photos and PDFs),
// invoices and payments, calendar appointments and blocks, tasks,
// communications, documents, email history, campaigns, suppressions,
// custom fields and saved reports:
//   node_modules/.bin/tsx --tsconfig tsconfig.json scripts/add-test-data.ts
// Builds on scripts/add-test-realtors.ts (run that first; its realtors are
// reused here). Dates are relative to the day it runs. Emails are
// @example.com (reserved: they can never reach anyone) and phones are
// fictional 555-01xx/02xx numbers. Test users get a random password nobody
// knows; use Settings → Users → Reset password to sign in as one.
// Runs once: a second run finds its own activity-log marker and stops.

const NOTE = "Test data — safe to delete.";
const SOURCE = "add-test-data";
const MARKER = "test_data.added";
const SENT_REASON = "Test data — not actually sent";
const TZ = process.env.APP_TIMEZONE?.trim() || "America/New_York";
const MEDIA_ROOT = path.join(process.cwd(), "storage", "media");
const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

type Tx = Prisma.TransactionClient;

const now = new Date();
const today = toDayKey(now, TZ);
const day = (offset: number): DayKey => addDays(today, offset);
const at = (offset: number, time: string) => zonedDateTimeToUtc(day(offset), time, TZ);
// Task due dates are calendar days anchored at local noon, like the app's.
const noon = (offset: number) => at(offset, "12:00");
const dateOnly = (offset: number) => dayKeyToDateOnly(day(offset));
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
// A @db.Date in an earlier year on the same month/day as `offset` days from now.
const yearsBack = (years: number, offset: number) => {
  const [y, m, d] = day(offset).split("-").map(Number);
  return new Date(Date.UTC(y - years, m - 1, d));
};

// Files are written after the database transaction commits.
const pendingFiles: { dest: string; bytes: () => Promise<Buffer> | Buffer }[] = [];
const pendingPdfs: { versionId: string; dest: string }[] = [];

async function main() {
  if (await prisma.activityLog.findFirst({ where: { action: MARKER }, select: { id: true } })) {
    console.log("Test data was already added (found its marker in the activity log). Nothing to do.");
    return;
  }

  const testUsers = [
    { key: "sam", name: "Sam Testinspector", email: "sam.testinspector@example.com", role: "INSPECTOR", active: true },
    { key: "robin", name: "Robin Fieldtest", email: "robin.fieldtest@example.com", role: "INSPECTOR", active: true },
    { key: "pat", name: "Pat Teststaff", email: "pat.teststaff@example.com", role: "OFFICE_STAFF", active: true },
    { key: "lee", name: "Lee Testanalyst", email: "lee.testanalyst@example.com", role: "REPORTING_ANALYST", active: true },
    { key: "former", name: "Former Testuser", email: "former.testuser@example.com", role: "INSPECTOR", active: false },
  ] as const;
  const passwordHashes = await Promise.all(testUsers.map(() => hashPassword(randomBytes(32).toString("base64url"))));

  const created = await prisma.$transaction((tx) => seed(tx, testUsers, passwordHashes), { timeout: 180_000, maxWait: 20_000 });

  for (const f of pendingFiles) {
    await mkdir(path.dirname(f.dest), { recursive: true });
    await writeFile(f.dest, await f.bytes());
  }
  for (const p of pendingPdfs) {
    const version = await prisma.reportVersion.findUniqueOrThrow({ where: { id: p.versionId }, select: { reportId: true, snapshot: true } });
    const media = await prisma.media.findMany({ where: { OR: [{ reportId: version.reportId }, { finding: { component: { section: { reportId: version.reportId } } } }] } });
    const pdf = await renderReportPdf(version.snapshot as unknown as ReportSnapshot, media);
    await mkdir(path.dirname(p.dest), { recursive: true });
    await writeFile(p.dest, pdf);
  }
  console.log(`wrote ${pendingFiles.length} photo/document files and ${pendingPdfs.length} report PDFs`);

  // The app's own email automations, as if staff had scheduled/completed
  // these in the app. Delivery mode decides whether anything leaves (simulated
  // on the server), and every recipient is @example.com regardless.
  for (const id of created.scheduledInspectionIds) await onInspectionScheduled(id, { quiet: true });
  await onInspectionCompleted(created.completedInspectionId, {});
  console.log("ran the inspection confirmation and thank-you automations");

  console.log("\nTest data added:");
  for (const [k, v] of Object.entries(created.counts)) console.log(`  ${k.padEnd(24)} ${v}`);
}

async function seed(tx: Tx, testUsers: readonly { key: string; name: string; email: string; role: string; active: boolean }[], passwordHashes: string[]) {
  const counts: Record<string, number> = {};
  const count = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  const logCreated = (entityType: string, entityId: string, after: Record<string, unknown>) =>
    logActivity(tx, { action: `${entityType.charAt(0).toLowerCase()}${entityType.slice(1)}.created`, entityType, entityId, after: { ...after, source: SOURCE } });

  // ---------------------------------------------------------------- users
  const user: Record<string, string> = {};
  for (const [i, u] of testUsers.entries()) {
    const existing = await tx.user.findUnique({ where: { email: u.email }, select: { id: true } });
    const row =
      existing ??
      (await tx.user.create({ data: { name: u.name, email: u.email, role: u.role as never, active: u.active, passwordHash: passwordHashes[i], mustChangePassword: true } }));
    if (!existing) {
      count("users");
      await logCreated("User", row.id, { name: u.name, email: u.email, role: u.role });
    }
    user[u.key] = row.id;
  }

  // ------------------------------------------------- lookups (seeded data)
  const category = Object.fromEntries((await tx.findingCategory.findMany()).map((c) => [c.key, c.id]));
  const serviceByName = async (name: string, create?: { basePrice: string; defaultDurationMinutes: number; active?: boolean; description?: string }) => {
    const existing = await tx.service.findFirst({ where: { name } });
    if (existing) return existing;
    if (!create) throw new Error(`Service "${name}" is missing — run the seed first.`);
    count("services");
    return tx.service.create({ data: { name, ...create } });
  };
  const svc = {
    general: await serviceByName("General Home Inspection"),
    radon: await serviceByName("Radon Test"),
    termite: await serviceByName("Termite / WDI Inspection"),
    sewer: await serviceByName("Sewer Scope (test)", { basePrice: "225.00", defaultDurationMinutes: 60, description: NOTE }),
  };
  await serviceByName("Mold Air Sampling (test)", { basePrice: "175.00", defaultDurationMinutes: 45, active: false, description: `Retired service. ${NOTE}` });

  const referral = async (name: string, type: string, extra: { active?: boolean; realtorId?: string } = {}) => {
    const existing = await tx.referralSource.findFirst({ where: { name } });
    if (existing) return existing.id;
    count("referral sources");
    return (await tx.referralSource.create({ data: { name, type, ...extra } })).id;
  };

  // ---------------------------------------------------------- brokerages
  const brokerage = async (data: { name: string; city: string; state: string; phone?: string; email?: string; addressLine1?: string; zip?: string; archivedAt?: Date }) => {
    const existing = await tx.brokerage.findFirst({ where: { name: data.name } });
    if (existing) return existing;
    const row = await tx.brokerage.create({ data });
    count("brokerages");
    await logCreated("Brokerage", row.id, { name: data.name });
    return row;
  };
  const trg = await brokerage({ name: "Test Realty Group", city: "Hickory", state: "NC", phone: "8285550100", email: "office@testrealty.example.com" });
  const shb = await brokerage({ name: "Sample Homes Brokerage", city: "Lenoir", state: "NC", phone: "8285550150", email: "hello@samplehomes.example.com" });
  const mvr = await brokerage({ name: "Mountain View Realty (Test)", city: "Boone", state: "NC", zip: "28607", addressLine1: "100 Test Ridge Rd", phone: "8285550160", email: "office@mountainview.example.com" });
  const cdr = await brokerage({ name: "Closed Doors Realty (Test)", city: "Morganton", state: "NC", phone: "8285550170", archivedAt: ago(60) });
  const brokerageName = new Map([trg, shb, mvr, cdr].map((b) => [b.id, b.name]));

  // ------------------------------------------------------------ realtors
  const realtorByEmail = async (email: string) => (await tx.realtor.findFirst({ where: { email }, select: { id: true, brokerageId: true } })) ?? null;
  const newRealtor = async (data: Prisma.RealtorUncheckedCreateInput, history: { brokerageId: string; startDate: Date; endDate?: Date }[]) => {
    const existing = await realtorByEmail(data.email!);
    if (existing) return existing;
    const row = await tx.realtor.create({ data: { notes: NOTE, ...data } });
    for (const h of history) await tx.realtorBrokerageHistory.create({ data: { realtorId: row.id, ...h } });
    count("realtors");
    await logCreated("Realtor", row.id, { firstName: data.firstName, lastName: data.lastName, email: data.email, brokerageId: data.brokerageId ?? null });
    return { id: row.id, brokerageId: row.brokerageId };
  };
  const existingRealtor = async (email: string, fallback: Prisma.RealtorUncheckedCreateInput) =>
    (await realtorByEmail(email)) ?? newRealtor({ ...fallback, email }, fallback.brokerageId ? [{ brokerageId: fallback.brokerageId, startDate: now }] : []);
  const r = {
    avery: await existingRealtor("avery.testwell@example.com", { firstName: "Avery", lastName: "Testwell", phone: "8285550101", brokerageId: trg.id }),
    jordan: await existingRealtor("jordan.sampleton@example.com", { firstName: "Jordan", lastName: "Sampleton", phone: "8285550102", brokerageId: trg.id }),
    morgan: await existingRealtor("morgan.demo@example.com", { firstName: "Morgan", lastName: "Demo", phone: "8285550103", brokerageId: trg.id }),
    riley: await existingRealtor("riley.example@example.com", { firstName: "Riley", lastName: "Example", phone: "8285550151", brokerageId: shb.id }),
    casey: await existingRealtor("casey.trialson@example.com", { firstName: "Casey", lastName: "Trialson", phone: "8285550152", brokerageId: shb.id }),
    taylor: await existingRealtor("taylor.mockford@example.com", { firstName: "Taylor", lastName: "Mockford", phone: "8285550153" }),
    quinn: await newRealtor(
      {
        firstName: "Quinn",
        lastName: "Placeholder",
        preferredName: "Q",
        email: "quinn.placeholder@example.com",
        phone: "8285550161",
        preferredContactMethod: "TEXT",
        licenseNumber: "TEST-NC-301",
        brokerageId: mvr.id,
        birthdayMonth: Number(day(5).slice(5, 7)),
        birthdayDay: Number(day(5).slice(8, 10)),
        careerStartDate: yearsBack(10, 10),
        relationshipStartDate: yearsBack(5, 17),
        marketingOptIn: true,
        marketingOptInSource: "Test data",
        marketingOptInAt: ago(90),
      },
      [{ brokerageId: mvr.id, startDate: yearsBack(10, 10) }]
    ),
    drew: await newRealtor(
      {
        firstName: "Drew",
        lastName: "Fakename",
        email: "drew.fakename@example.com",
        phone: "8285550162",
        preferredContactMethod: "EMAIL",
        brokerageId: mvr.id,
        birthdayMonth: Number(day(1).slice(5, 7)),
        birthdayDay: Number(day(1).slice(8, 10)),
        relationshipEmailsEnabled: false,
        marketingUnsubscribedAt: ago(20),
      },
      [{ brokerageId: mvr.id, startDate: yearsBack(3, 0) }]
    ),
    jamie: await newRealtor(
      {
        firstName: "Jamie",
        lastName: "Movedover",
        email: "jamie.movedover@example.com",
        phone: "8285550154",
        preferredContactMethod: "PHONE",
        licenseNumber: "TEST-NC-415",
        brokerageId: shb.id,
        careerStartDate: yearsBack(11, 40),
        marketingOptIn: true,
        marketingOptInSource: "Test data",
        marketingOptInAt: ago(200),
      },
      [
        { brokerageId: trg.id, startDate: new Date("2019-03-01"), endDate: new Date("2024-06-30") },
        { brokerageId: shb.id, startDate: new Date("2024-07-01") },
      ]
    ),
    sam: await newRealtor(
      { firstName: "Sam", lastName: "Archivedson", email: "sam.archivedson@example.com", phone: "8285550171", brokerageId: cdr.id, archivedAt: ago(60) },
      [{ brokerageId: cdr.id, startDate: new Date("2018-01-15") }]
    ),
  };

  const src = {
    realtorReferral: await referral("Realtor referral", "Realtor"),
    pastCustomer: await referral("Past customer", "Past Customer"),
    google: await referral("Google / Online search", "Online"),
    facebook: await referral("Facebook ad (test)", "Online"),
    homeShow: await referral("Home show booth (test)", "Event", { active: false }),
    avery: await referral("Avery Testwell", "Realtor", { realtorId: r.avery.id }),
    quinn: await referral("Quinn Placeholder", "Realtor", { realtorId: r.quinn.id }),
  };

  // ---------------------------------------------------------- properties
  const property = async (data: Prisma.PropertyUncheckedCreateInput) => {
    const row = await tx.property.create({ data });
    count("properties");
    await logCreated("Property", row.id, { addressLine1: data.addressLine1, city: data.city });
    return row;
  };
  const p = {
    p1: await property({ addressLine1: "101 Testing Ln", city: "Hickory", state: "NC", zip: "28601", county: "Catawba", yearBuilt: 1998, squareFootage: 2150 }),
    p2: await property({ addressLine1: "202 Sample St", addressLine2: "Unit B", city: "Lenoir", state: "NC", zip: "28645", county: "Caldwell", yearBuilt: 1975, squareFootage: 1480 }),
    p3: await property({ addressLine1: "303 Example Ave", city: "Hickory", state: "NC", zip: "28602", county: "Catawba", yearBuilt: 2006, squareFootage: 2875 }),
    p4: await property({ addressLine1: "404 Demo Dr", city: "Boone", state: "NC", zip: "28607", county: "Watauga", yearBuilt: 1962, squareFootage: 1920 }),
    p5: await property({ addressLine1: "505 Mockingbird Test Rd", city: "Morganton", state: "NC", zip: "28655", county: "Burke", yearBuilt: 2015, squareFootage: 3100 }),
    // Year built and size unknown, so readiness checks have something to flag.
    p6: await property({ addressLine1: "606 Placeholder Pl", city: "Hickory", state: "NC", zip: "28601" }),
    p7: await property({ addressLine1: "707 Fixture Ct", city: "Lenoir", state: "NC", zip: "28645", county: "Caldwell", yearBuilt: 1988, squareFootage: 1760 }),
    p8: await property({ addressLine1: "808 Trial Way", city: "Boone", state: "NC", zip: "28607", county: "Watauga", yearBuilt: 2001, squareFootage: 2400 }),
    p9: await property({ addressLine1: "909 Seed Blvd", city: "Hickory", state: "NC", zip: "28602", county: "Catawba", yearBuilt: 1955, squareFootage: 1300 }),
  };
  const addressOf = (prop: { addressLine1: string; city: string }) => `${prop.addressLine1}, ${prop.city}`;

  // ----------------------------------------------------------- customers
  const customer = async (firstName: string, lastName: string, phone: string, opts: { email?: string | null; archivedAt?: Date } = {}) => {
    const email = opts.email === undefined ? `${firstName}.${lastName}@example.com`.toLowerCase() : opts.email;
    const row = await tx.customer.create({ data: { firstName, lastName, email, phone, archivedAt: opts.archivedAt } });
    count("customers");
    await logCreated("Customer", row.id, { firstName, lastName, email });
    return row;
  };
  const c = {
    alex: await customer("Alex", "Buyertest", "8285550201"),
    chris: await customer("Chris", "Testbuyer", "8285550202"),
    dana: await customer("Dana", "Testbuyer", "8285550203"),
    elliot: await customer("Elliot", "Sampleperson", "8285550204"),
    frankie: await customer("Frankie", "Democustomer", "8285550205"),
    gale: await customer("Gale", "Fixturely", "8285550206"),
    harper: await customer("Harper", "Mockley", "8285550207"),
    indy: await customer("Indy", "Testseller", "8285550208"),
    jules: await customer("Jules", "Closedeal", "8285550209"),
    kai: await customer("Kai", "Cancelson", "8285550210"),
    // No email on file: confirmations are skipped and the readiness check warns.
    logan: await customer("Logan", "Noemail", "8285550211", { email: null }),
    noel: await customer("Noel", "Futurebuyer", "8285550212"),
    oakley: await customer("Oakley", "Archivedtest", "8285550213", { archivedAt: ago(30) }),
  };

  // --------------------------------------------------------------- leads
  const lead = async (data: Prisma.LeadUncheckedCreateInput) => {
    const row = await tx.lead.create({ data: { notes: NOTE, ...data } });
    count("leads");
    await logCreated("Lead", row.id, { firstName: data.firstName, lastName: data.lastName, status: data.status });
    return row;
  };
  await lead({ firstName: "Alex", lastName: "Buyertest", email: c.alex.email, phone: c.alex.phone, status: "CONVERTED", referralSourceId: src.realtorReferral, convertedCustomerId: c.alex.id, convertedAt: ago(2), createdAt: ago(4) });
  await lead({ firstName: "Bailey", lastName: "Newlead", email: "bailey.newlead@example.com", phone: "8285550221", status: "NEW", referralSourceId: src.google });
  await lead({ firstName: "Cameron", lastName: "Calledback", email: "cameron.calledback@example.com", phone: "8285550222", status: "CONTACTED", referralSourceId: src.facebook, createdAt: ago(3) });
  await lead({ firstName: "Devon", lastName: "Qualified", email: "devon.qualified@example.com", phone: "8285550223", status: "QUALIFIED", referralSourceId: src.avery, createdAt: ago(6) });
  await lead({ firstName: "Emery", lastName: "Lostlead", email: "emery.lostlead@example.com", status: "LOST", referralSourceId: src.homeShow, createdAt: ago(25) });
  await lead({ firstName: "Finley", lastName: "Nosource", phone: "8285550225", status: "NEW", createdAt: ago(1) });

  // -------------------------------------------------------- transactions
  const transaction = async (data: {
    status: Prisma.TransactionUncheckedCreateInput["status"];
    propertyId?: string;
    referralSourceId: string;
    closing?: number;
    deadline?: number;
    createdDaysAgo: number;
    customers: { id: string; role: "PRIMARY_BUYER" | "SECONDARY_BUYER" | "SELLER" | "OTHER" }[];
    realtors: { id: string; brokerageId: string | null; role: RealtorParticipantRole }[];
  }) => {
    const row = await tx.transaction.create({
      data: {
        status: data.status,
        propertyId: data.propertyId,
        referralSourceId: data.referralSourceId,
        closingDate: data.closing === undefined ? null : dateOnly(data.closing),
        inspectionDeadline: data.deadline === undefined ? null : dateOnly(data.deadline),
        createdAt: ago(data.createdDaysAgo),
      },
    });
    for (const [i, cu] of data.customers.entries()) {
      await tx.transactionCustomer.create({ data: { transactionId: row.id, customerId: cu.id, role: cu.role, primaryContact: i === 0 } });
    }
    for (const re of data.realtors) {
      await tx.transactionRealtor.create({
        data: { transactionId: row.id, realtorId: re.id, role: re.role, brokerageId: re.brokerageId, brokerageName: re.brokerageId ? (brokerageName.get(re.brokerageId) ?? null) : null },
      });
    }
    count("transactions");
    await logCreated("Transaction", row.id, { status: data.status, propertyId: data.propertyId ?? null });
    return row;
  };
  const ra = (realtor: { id: string; brokerageId: string | null }, role: RealtorParticipantRole) => ({ ...realtor, role });

  const t1 = await transaction({ status: "LEAD_IN_PROGRESS", referralSourceId: src.realtorReferral, createdDaysAgo: 2, customers: [{ id: c.alex.id, role: "PRIMARY_BUYER" }], realtors: [] });
  const t2 = await transaction({
    status: "SCHEDULED",
    propertyId: p.p1.id,
    referralSourceId: src.avery,
    closing: 35,
    deadline: 7,
    createdDaysAgo: 5,
    customers: [
      { id: c.chris.id, role: "PRIMARY_BUYER" },
      { id: c.dana.id, role: "SECONDARY_BUYER" },
    ],
    realtors: [ra(r.avery, "BUYER_AGENT"), ra(r.riley, "LISTING_AGENT")],
  });
  const t3 = await transaction({ status: "SCHEDULED", propertyId: p.p3.id, referralSourceId: src.google, closing: 40, deadline: 10, createdDaysAgo: 3, customers: [{ id: c.elliot.id, role: "PRIMARY_BUYER" }], realtors: [ra(r.quinn, "BUYER_AGENT"), ra(r.jordan, "LISTING_AGENT")] });
  const t4 = await transaction({ status: "IN_PROGRESS", propertyId: p.p4.id, referralSourceId: src.pastCustomer, closing: 28, deadline: 3, createdDaysAgo: 9, customers: [{ id: c.frankie.id, role: "PRIMARY_BUYER" }], realtors: [ra(r.morgan, "BUYER_AGENT")] });
  const t5 = await transaction({ status: "COMPLETED", propertyId: p.p5.id, referralSourceId: src.avery, closing: 20, deadline: -1, createdDaysAgo: 14, customers: [{ id: c.gale.id, role: "PRIMARY_BUYER" }], realtors: [ra(r.avery, "BUYER_AGENT"), ra(r.casey, "LISTING_AGENT")] });
  const t6 = await transaction({
    status: "COMPLETED",
    propertyId: p.p6.id,
    referralSourceId: src.facebook,
    closing: 12,
    deadline: -5,
    createdDaysAgo: 18,
    customers: [
      { id: c.harper.id, role: "PRIMARY_BUYER" },
      { id: c.indy.id, role: "SELLER" },
    ],
    realtors: [ra(r.taylor, "BUYER_AGENT")],
  });
  const t7 = await transaction({ status: "CLOSED", propertyId: p.p7.id, referralSourceId: src.pastCustomer, closing: -15, deadline: -40, createdDaysAgo: 55, customers: [{ id: c.jules.id, role: "PRIMARY_BUYER" }], realtors: [ra(r.jordan, "BUYER_AGENT"), ra(r.jamie, "LISTING_AGENT")] });
  const t8 = await transaction({ status: "CANCELLED", propertyId: p.p8.id, referralSourceId: src.google, closing: 25, createdDaysAgo: 10, customers: [{ id: c.kai.id, role: "PRIMARY_BUYER" }], realtors: [ra(r.riley, "BUYER_AGENT")] });
  const t9 = await transaction({ status: "SCHEDULED", propertyId: p.p9.id, referralSourceId: src.quinn, closing: 21, deadline: 16, createdDaysAgo: 1, customers: [{ id: c.logan.id, role: "PRIMARY_BUYER" }], realtors: [ra(r.quinn, "BUYER_AGENT"), ra(r.morgan, "TRANSACTION_COORDINATOR")] });
  const t10 = await transaction({ status: "SCHEDULED", propertyId: p.p2.id, referralSourceId: src.realtorReferral, closing: 60, deadline: 36, createdDaysAgo: 1, customers: [{ id: c.noel.id, role: "PRIMARY_BUYER" }], realtors: [ra(r.casey, "BUYER_AGENT")] });

  // --------------------------------------------------------- inspections
  const inspection = async (data: {
    transactionId: string;
    propertyId: string;
    inspectorId: string | null;
    status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
    when: [number, string];
    durationMinutes: number;
    services: { id: string; basePrice: Prisma.Decimal }[];
    extra?: Partial<Prisma.InspectionUncheckedCreateInput>;
  }) => {
    const row = await tx.inspection.create({
      data: {
        transactionId: data.transactionId,
        propertyId: data.propertyId,
        inspectorId: data.inspectorId,
        status: data.status,
        scheduledAt: at(...data.when),
        durationMinutes: data.durationMinutes,
        inspectionServices: { create: data.services.map((s) => ({ serviceId: s.id, price: s.basePrice })) },
        ...data.extra,
      },
    });
    count("inspections");
    await logActivity(tx, {
      action: "inspection.scheduled",
      entityType: "Inspection",
      entityId: row.id,
      after: { scheduledAt: row.scheduledAt?.toISOString() ?? null, durationMinutes: data.durationMinutes, inspectorId: data.inspectorId, transactionId: data.transactionId, source: SOURCE },
    });
    return row;
  };
  const conditions = { weather: "Sunny", temperatureF: 61, occupancyStatus: "Vacant", utilitiesOn: true };
  const i2 = await inspection({
    transactionId: t2.id,
    propertyId: p.p1.id,
    inspectorId: user.sam,
    status: "SCHEDULED",
    when: [3, "09:00"],
    durationMinutes: 210,
    services: [svc.general, svc.radon],
    extra: { accessNotes: "Lockbox on the front door; code from the listing agent." },
  });
  const i3 = await inspection({ transactionId: t3.id, propertyId: p.p3.id, inspectorId: user.robin, status: "SCHEDULED", when: [6, "13:00"], durationMinutes: 225, services: [svc.general, svc.termite], extra: { agreementSignedAt: ago(1) } });
  const i4 = await inspection({
    transactionId: t4.id,
    propertyId: p.p4.id,
    inspectorId: user.sam,
    status: "IN_PROGRESS",
    when: [0, "09:00"],
    durationMinutes: 180,
    services: [svc.general],
    extra: { agreementSignedAt: ago(3), startedAt: at(0, "09:10"), ...conditions },
  });
  const i5 = await inspection({
    transactionId: t5.id,
    propertyId: p.p5.id,
    inspectorId: user.robin,
    status: "COMPLETED",
    when: [-3, "09:00"],
    durationMinutes: 240,
    services: [svc.general, svc.radon, svc.sewer],
    extra: { agreementSignedAt: ago(10), startedAt: at(-3, "09:05"), completedAt: at(-3, "13:30"), ...conditions, occupancyStatus: "Occupied", temperatureF: 58, createdAt: ago(10) },
  });
  const i6 = await inspection({
    transactionId: t6.id,
    propertyId: p.p6.id,
    inspectorId: user.sam,
    status: "COMPLETED",
    when: [-8, "10:00"],
    durationMinutes: 180,
    services: [svc.general],
    extra: { agreementSignedAt: ago(12), startedAt: at(-8, "10:00"), completedAt: at(-8, "13:15"), weather: "Light rain", temperatureF: 54, occupancyStatus: "Occupied", utilitiesOn: true, createdAt: ago(12) },
  });
  const i7 = await inspection({
    transactionId: t7.id,
    propertyId: p.p7.id,
    inspectorId: user.robin,
    status: "COMPLETED",
    when: [-45, "09:00"],
    durationMinutes: 225,
    services: [svc.general, svc.termite],
    extra: { agreementSignedAt: ago(50), startedAt: at(-45, "09:00"), completedAt: at(-45, "12:45"), ...conditions, temperatureF: 78, createdAt: ago(50) },
  });
  const i8 = await inspection({ transactionId: t8.id, propertyId: p.p8.id, inspectorId: user.sam, status: "CANCELLED", when: [-2, "14:00"], durationMinutes: 180, services: [svc.general], extra: { scheduleVersion: 1, createdAt: ago(9) } });
  // Unassigned on purpose: the calendar and dashboard flag it.
  const i9 = await inspection({ transactionId: t9.id, propertyId: p.p9.id, inspectorId: null, status: "SCHEDULED", when: [13, "10:00"], durationMinutes: 45, services: [svc.termite] });
  const i10 = await inspection({ transactionId: t10.id, propertyId: p.p2.id, inspectorId: user.sam, status: "SCHEDULED", when: [33, "09:00"], durationMinutes: 240, services: [svc.general, svc.sewer], extra: { agreementSignedAt: ago(0) } });

  // ------------------------------------------------------ report templates
  const template =
    (await tx.reportTemplate.findFirst({
      where: { name: "Standard Residential Inspection (placeholder)" },
      include: { sections: { where: { active: true }, orderBy: { displayOrder: "asc" }, include: { components: { where: { active: true }, orderBy: { displayOrder: "asc" } } } } },
    })) ?? null;
  if (!template) throw new Error("The placeholder report template is missing — run the seed first.");
  await tx.reportTemplate.create({
    data: {
      name: "Condo / Townhome (test)",
      description: NOTE,
      sections: {
        create: [
          { name: "Interior", displayOrder: 0, components: { create: [{ name: "Walls & Ceilings", displayOrder: 0 }, { name: "Windows", displayOrder: 1 }, { name: "Doors", displayOrder: 2 }] } },
          { name: "HVAC", displayOrder: 1, components: { create: [{ name: "Heating", displayOrder: 0 }, { name: "Cooling", displayOrder: 1 }, { name: "Ductwork", displayOrder: 2, active: false }] } },
          { name: "Grounds (unused)", displayOrder: 2, active: false, components: { create: [{ name: "Grading", displayOrder: 0 }] } },
        ],
      },
    },
  });
  await tx.reportTemplate.create({ data: { name: "Old checklist (test, inactive)", description: NOTE, active: false, sections: { create: [{ name: "General", components: { create: [{ name: "Overall condition" }] } }] } } });
  count("report templates", 2);

  // ---------------------------------------------------------- narratives
  const narratives: Prisma.NarrativeUncheckedCreateInput[] = [
    { title: "Missing GFCI protection", sectionHint: "Electrical", componentHint: "GFCI Protection", narrativeText: "Outlets near water sources were not GFCI protected.", recommendationText: "Have a licensed electrician install GFCI protection at all required locations." },
    { title: "Water heater nearing end of life", sectionHint: "Plumbing", componentHint: "Water Heater", narrativeText: "The water heater is near or past its typical service life.", recommendationText: "Budget for replacement and monitor for leaks." },
    { title: "Worn shingles", sectionHint: "Roofing", componentHint: "Roof Covering", narrativeText: "Shingles show granule loss and curling.", recommendationText: "Have a licensed roofer evaluate and repair as needed." },
    { title: "Loose flashing at chimney", sectionHint: "Roofing", componentHint: "Flashing", narrativeText: "Flashing at the chimney is loose and could let water in.", recommendationText: "Have a roofer reseal or replace the flashing." },
    { title: "Double-tapped breaker", sectionHint: "Electrical", componentHint: "Main Panel", narrativeText: "Two conductors are connected to a single-pole breaker not rated for it.", recommendationText: "Have a licensed electrician correct the connection." },
    { title: "Old roof wording (test, inactive)", sectionHint: "Roofing", narrativeText: "Superseded narrative kept for history.", active: false },
  ];
  for (const n of narratives) await tx.narrative.create({ data: { ...n, createdById: user.robin } });
  count("narratives", narratives.length);

  // ------------------------------------------------------------- reports
  type FindingSpec = {
    component: string;
    title: string;
    description: string;
    category: string;
    recommendation?: string;
    professional?: string;
    location?: string;
    flags?: Partial<Record<"safetyRelated" | "repairRecommended" | "monitor" | "furtherEvaluation" | "includedInSummary", boolean>>;
    photos?: (string | null)[]; // captions; null = a photo with no caption
    estimatedCost?: number;
  };
  const findingIds: string[] = [];
  const report = async (opts: {
    inspection: { id: string };
    status: ReportStatus;
    inspected: Record<string, ComponentInspectionStatus | [ComponentInspectionStatus, string]>; // component name → status (and limitation note)
    findings: FindingSpec[];
    coverPhoto?: boolean;
    extra?: Partial<Prisma.InspectionReportUncheckedCreateInput>;
  }) => {
    const row = await tx.inspectionReport.create({
      data: {
        inspectionId: opts.inspection.id,
        templateId: template.id,
        reportNumber: generateReportNumber(),
        status: opts.status,
        title: "Home Inspection Report",
        introduction: "This report describes the visible condition of the home on the day of the inspection.",
        scope: "A visual, non-invasive inspection of readily accessible systems and components.",
        limitations: "Concealed conditions, cosmetic items and future performance are outside the scope.",
        footer: "Test data — not a real inspection report.",
        internalNotes: NOTE,
        customerFacingNotes: "Call us with any questions about this report.",
        ...opts.extra,
        sections: {
          create: template.sections.map((s) => ({
            name: s.name,
            displayOrder: s.displayOrder,
            components: {
              create: s.components.map((comp) => {
                const st = opts.inspected[comp.name];
                const [inspectionStatus, limitationNote] = Array.isArray(st) ? st : [st ?? "NOT_INSPECTED", null];
                return { name: comp.name, displayOrder: comp.displayOrder, inspectionStatus, limitationNote };
              }),
            },
          })),
        },
      },
      include: { sections: { include: { components: true } } },
    });
    const componentId = new Map(row.sections.flatMap((s) => s.components.map((comp) => [comp.name, comp.id])));
    for (const [idx, f] of opts.findings.entries()) {
      const finding = await tx.finding.create({
        data: {
          componentId: componentId.get(f.component)!,
          categoryId: category[f.category] ?? null,
          title: f.title,
          description: f.description,
          location: f.location ?? null,
          recommendation: f.recommendation ?? null,
          recommendedProfessional: f.professional ?? null,
          ...f.flags,
          inspectorNotes: NOTE,
          displayOrder: idx,
          createdById: user.robin,
        },
      });
      findingIds.push(finding.id);
      count("findings");
      if (f.estimatedCost !== undefined) estimatedCosts.push({ findingId: finding.id, amount: f.estimatedCost });
      for (const [pIdx, caption] of (f.photos ?? []).entries()) {
        await photo(opts.inspection.id, row.id, finding.id, caption, pIdx, idx * 3 + pIdx);
      }
    }
    if (opts.coverPhoto) await photo(opts.inspection.id, row.id, null, "Front of the home", 0, 99);
    await syncReportSummary(tx, row.id);
    count("reports");
    return row;
  };
  const estimatedCosts: { findingId: string; amount: number }[] = [];
  const photo = async (inspectionId: string, reportId: string, findingId: string | null, caption: string | null, displayOrder: number, seedNo: number) => {
    const fileName = `test-photo-${seedNo + 1}.png`;
    const storageKey = `${inspectionId}/${randomUUID()}-${fileName}`;
    await tx.media.create({ data: { inspectionId, reportId, findingId, storageKey, fileType: "image/png", originalFileName: fileName, caption, displayOrder, uploadedById: user.robin } });
    pendingFiles.push({ dest: path.join(MEDIA_ROOT, storageKey), bytes: () => testImage(seedNo) });
    count("photos");
  };

  const allInspected = (overrides: Record<string, ComponentInspectionStatus | [ComponentInspectionStatus, string]> = {}) => ({
    ...Object.fromEntries(template.sections.flatMap((s) => s.components.map((comp) => [comp.name, "INSPECTED" as const]))),
    ...overrides,
  });

  // In progress today: roofing done, electrical half done, plumbing not started.
  await report({
    inspection: i4,
    status: "IN_PROGRESS",
    inspected: { "Roof Covering": "INSPECTED", Flashing: "INSPECTED", "Service Entrance": "INSPECTED" },
    findings: [
      { component: "Roof Covering", title: "Architectural shingles, about 8 years old", description: "The roof covering is architectural asphalt shingle in serviceable condition.", category: "INFORMATIONAL" },
      { component: "Flashing", title: "Loose flashing at chimney", description: "Flashing at the chimney is loose and could let water in.", category: "REPAIR_RECOMMENDED", recommendation: "Have a roofer reseal or replace the flashing.", professional: "Licensed roofer", flags: { repairRecommended: true, includedInSummary: true }, photos: ["Gap at the chimney flashing"] },
    ],
  });

  // Delivered: finalized two days ago, sent to the buyer and their agent.
  const r5 = await report({
    inspection: i5,
    status: "DELIVERED",
    inspected: allInspected({ Flashing: ["NOT_ACCESSIBLE", "Steep pitch; viewed from the ground with binoculars."] }),
    coverPhoto: true,
    findings: [
      { component: "Roof Covering", title: "Worn shingles on the south slope", description: "Shingles show granule loss and curling on the south-facing slope.", category: "REPAIR_RECOMMENDED", recommendation: "Have a licensed roofer evaluate and repair as needed.", professional: "Licensed roofer", location: "South slope", flags: { repairRecommended: true, includedInSummary: true }, photos: ["Granule loss on the south slope", "Curled shingle edges"], estimatedCost: 1200 },
      { component: "Main Panel", title: "Double-tapped breaker", description: "Two conductors are connected to a single-pole breaker not rated for it.", category: "SAFETY_CONCERN", recommendation: "Have a licensed electrician correct the connection.", professional: "Licensed electrician", location: "Garage panel, breaker 14", flags: { safetyRelated: true, repairRecommended: true, includedInSummary: true }, photos: ["Breaker 14 with two conductors"], estimatedCost: 250 },
      { component: "GFCI Protection", title: "No GFCI protection at kitchen counter outlets", description: "Outlets along the kitchen counter were not GFCI protected.", category: "SAFETY_CONCERN", recommendation: "Have a licensed electrician install GFCI protection at all required locations.", professional: "Licensed electrician", location: "Kitchen", flags: { safetyRelated: true, repairRecommended: true, includedInSummary: true }, photos: [null] },
      { component: "Water Heater", title: "Water heater is 14 years old", description: "The water heater is past its typical service life but working.", category: "MONITOR", recommendation: "Budget for replacement and monitor for leaks.", location: "Basement", flags: { monitor: true } },
      { component: "Fixtures", title: "Slow drain at hall bath sink", description: "The hall bathroom sink drains slowly.", category: "MAINTENANCE", recommendation: "Clear the drain.", location: "Hall bathroom" },
    ],
    extra: { finalizedAt: ago(2), finalizedById: user.robin, deliveredAt: ago(2) },
  });

  // Ready for review, past its report deadline.
  await report({
    inspection: i6,
    status: "READY_FOR_REVIEW",
    inspected: allInspected({ "Service Entrance": ["LIMITED_INSPECTION", "Meter base partly blocked by shrubs."] }),
    findings: [
      { component: "Roof Covering", title: "Possible moisture stain on bedroom ceiling", description: "A stain below the roof line suggests a past or active leak.", category: "FURTHER_EVALUATION", recommendation: "Have a roofer evaluate the roof above the stain.", professional: "Licensed roofer", location: "Primary bedroom ceiling", flags: { furtherEvaluation: true, includedInSummary: true }, photos: ["Ceiling stain in the primary bedroom"] },
      // No recommendation yet, so finalizing would warn about it.
      { component: "Water Heater", title: "No drip pan under the water heater", description: "The water heater has no drip pan or drain line.", category: "MAINTENANCE", location: "Hall closet" },
    ],
  });

  // Closed deal: delivered, then amended once (version 2).
  const r7 = await report({
    inspection: i7,
    status: "DELIVERED",
    inspected: allInspected(),
    findings: [
      { component: "Water Heater", title: "Water heater is 9 years old", description: "The water heater is working; typical life is 10–12 years.", category: "INFORMATIONAL", location: "Garage" },
      { component: "Fixtures", title: "Running toilet in the primary bath", description: "The toilet runs continuously after flushing.", category: "REPAIR_RECOMMENDED", recommendation: "Replace the flapper or fill valve.", professional: "Plumber", location: "Primary bathroom", flags: { repairRecommended: true, includedInSummary: true }, photos: ["Toilet tank fill valve"] },
    ],
    extra: { finalizedAt: ago(40), finalizedById: user.robin, deliveredAt: ago(40) },
  });

  const finalize = async (reportId: string, versionNumber: number, finalizedAt: Date, reasonForRevision: string | null) => {
    const snapshot = await buildSnapshot(tx, reportId, versionNumber, finalizedAt, reasonForRevision);
    const pdfStorageKey = path.join("report-pdfs", `${reportId}/v${versionNumber}-${randomUUID()}.pdf`);
    const version = await tx.reportVersion.create({ data: { reportId, versionNumber, snapshot: snapshot as unknown as Prisma.InputJsonValue, pdfStorageKey, reasonForRevision, createdById: user.robin, finalizedAt } });
    pendingPdfs.push({ versionId: version.id, dest: path.join(UPLOAD_ROOT, pdfStorageKey) });
    count("report versions");
    return version;
  };
  const delivery = async (reportId: string, versionId: string, d: { type: "CUSTOMER" | "SECONDARY_CUSTOMER" | "REALTOR" | "OTHER_AUTHORIZED"; name: string; email: string; method: "email" | "link"; status: "SENT" | "VIEWED" | "FAILED"; when: Date; revokedAt?: Date }) => {
    const row = await tx.reportDelivery.create({
      data: {
        reportId,
        versionId,
        recipientType: d.type,
        recipientName: d.name,
        recipientEmail: d.email,
        deliveryMethod: d.method,
        status: d.status,
        deliveredAt: d.when,
        deliveredById: user.robin,
        // The raw token is never kept, so these test links can't be opened.
        accessTokenHash: createHash("sha256").update(randomUUID() + randomUUID()).digest("hex"),
        accessExpiresAt: new Date(d.when.getTime() + 30 * 86_400_000),
        revokedAt: d.revokedAt,
      },
    });
    count("report deliveries");
    return row;
  };

  const r5v1 = await finalize(r5.id, 1, ago(2), null);
  await delivery(r5.id, r5v1.id, { type: "CUSTOMER", name: "Gale Fixturely", email: c.gale.email!, method: "link", status: "VIEWED", when: ago(2) });
  const r5Realtor = await delivery(r5.id, r5v1.id, { type: "REALTOR", name: "Avery Testwell", email: "avery.testwell@example.com", method: "email", status: "SENT", when: ago(2) });
  await delivery(r5.id, r5v1.id, { type: "OTHER_AUTHORIZED", name: "Wrong Recipient", email: "wrong.recipient@example.com", method: "link", status: "SENT", when: ago(2), revokedAt: ago(2) });
  await finalize(r7.id, 1, ago(44), null);
  const r7v2 = await finalize(r7.id, 2, ago(40), "Corrected the water heater age in Plumbing.");
  await delivery(r7.id, r7v2.id, { type: "CUSTOMER", name: "Jules Closedeal", email: c.jules.email!, method: "link", status: "VIEWED", when: ago(40) });

  // ------------------------------------------------------------ invoices
  const invoice = async (d: {
    number: string;
    transactionId: string;
    inspectionId?: string;
    status: "DRAFT" | "SENT" | "PAID" | "PARTIALLY_PAID" | "OVERDUE" | "VOID";
    items: [string, string][];
    issued?: number;
    due?: number;
    voidedAt?: Date;
    payments?: { amount: string; method: "CARD" | "ACH" | "CHECK" | "CASH" | "OTHER"; reference?: string; daysAgo: number }[];
  }) => {
    const row = await tx.invoice.create({
      data: {
        invoiceNumber: d.number,
        transactionId: d.transactionId,
        inspectionId: d.inspectionId,
        status: d.status,
        issuedAt: d.issued === undefined ? null : noon(d.issued),
        dueAt: d.due === undefined ? null : noon(d.due),
        voidedAt: d.voidedAt,
        items: { create: d.items.map(([description, amount]) => ({ description, amount })) },
        payments: { create: (d.payments ?? []).map((pay) => ({ amount: pay.amount, method: pay.method, reference: pay.reference ?? null, paidAt: ago(pay.daysAgo) })) },
      },
    });
    count("invoices");
    count("payments", d.payments?.length ?? 0);
    return row;
  };
  await invoice({ number: "INV-TEST-1001", transactionId: t7.id, inspectionId: i7.id, status: "PAID", items: [["General Home Inspection", "450.00"], ["Termite / WDI Inspection", "95.00"]], issued: -45, due: -38, payments: [{ amount: "545.00", method: "ACH", reference: "Test ACH 0001", daysAgo: 44 }] });
  await invoice({ number: "INV-TEST-1002", transactionId: t2.id, inspectionId: i2.id, status: "DRAFT", items: [["General Home Inspection", "450.00"], ["Radon Test", "150.00"]] });
  await invoice({ number: "INV-TEST-1003", transactionId: t3.id, inspectionId: i3.id, status: "SENT", items: [["General Home Inspection", "450.00"], ["Termite / WDI Inspection", "95.00"]], issued: -1, due: 6 });
  await invoice({ number: "INV-TEST-1005", transactionId: t5.id, inspectionId: i5.id, status: "PAID", items: [["General Home Inspection", "450.00"], ["Radon Test", "150.00"], ["Sewer Scope (test)", "225.00"]], issued: -3, due: 4, payments: [{ amount: "825.00", method: "CARD", reference: "Test card ending 4242", daysAgo: 3 }] });
  await invoice({ number: "INV-TEST-1006", transactionId: t6.id, inspectionId: i6.id, status: "PARTIALLY_PAID", items: [["General Home Inspection", "450.00"]], issued: -8, due: -1, payments: [{ amount: "200.00", method: "CHECK", reference: "Check #1042", daysAgo: 8 }] });
  const inv7 = await invoice({ number: "INV-TEST-1007", transactionId: t6.id, status: "OVERDUE", items: [["Re-inspection visit", "125.00"]], issued: -20, due: -6 });
  await invoice({ number: "INV-TEST-1008", transactionId: t8.id, inspectionId: i8.id, status: "VOID", items: [["General Home Inspection", "450.00"]], issued: -9, due: -2, voidedAt: ago(2) });
  await invoice({ number: "INV-TEST-1009", transactionId: t10.id, inspectionId: i10.id, status: "SENT", items: [["General Home Inspection", "450.00"], ["Sewer Scope (test)", "225.00"], ["Discount (test)", "-50.00"]], issued: 0, due: 33, payments: [{ amount: "100.00", method: "CASH", reference: "Deposit", daysAgo: 0 }] });

  // -------------------------------------------- calendar: blocks & appointments
  const appointment = async (d: Prisma.AppointmentUncheckedCreateInput) => {
    await tx.appointment.create({ data: d });
    count("appointments & blocks");
  };
  await appointment({ kind: "BLOCK", userId: user.sam, title: "Out of office (test)", startAt: at(5, "12:00"), endAt: at(5, "17:00") });
  await appointment({ kind: "BLOCK", userId: user.robin, title: "Training (test)", startAt: at(4, "08:00"), endAt: at(4, "12:00") });
  await appointment({ kind: "APPOINTMENT", userId: user.robin, transactionId: t5.id, inspectionId: i5.id, title: "Re-inspection walkthrough (test)", startAt: at(6, "16:00"), endAt: at(6, "16:30"), location: addressOf(p.p5) });
  await appointment({ kind: "APPOINTMENT", userId: user.sam, title: "Coffee with Quinn Placeholder (test)", startAt: at(1, "10:00"), endAt: at(1, "11:00"), location: "Test Coffee Co., Boone" });
  await appointment({ kind: "APPOINTMENT", userId: user.pat, title: "Pre-listing consult (test, cancelled)", startAt: at(2, "15:00"), endAt: at(2, "16:00"), cancelledAt: ago(0) });

  // --------------------------------------------------------------- tasks
  const task = async (d: { title: string; due: number | null; assigneeId?: string | null; transactionId?: string; realtorId?: string; completedDaysAgo?: number }) => {
    await tx.task.create({
      data: {
        title: d.title,
        description: NOTE,
        dueAt: d.due === null ? null : noon(d.due),
        assigneeId: d.assigneeId ?? null,
        transactionId: d.transactionId,
        realtorId: d.realtorId,
        completedAt: d.completedDaysAgo === undefined ? null : ago(d.completedDaysAgo),
      },
    });
    count("tasks");
  };
  await task({ title: "Get the property address from Alex", due: 0, assigneeId: user.pat, transactionId: t1.id });
  await task({ title: "Collect the signed inspection agreement", due: 1, assigneeId: user.pat, transactionId: t2.id });
  await task({ title: "Confirm the lockbox code with the listing agent", due: 2, assigneeId: user.pat, transactionId: t2.id });
  await task({ title: "Finish and send the report", due: -1, assigneeId: user.sam, transactionId: t6.id });
  await task({ title: "Collect the remaining balance", due: 3, assigneeId: user.pat, transactionId: t6.id });
  await task({ title: "Ask Jules for a review", due: -12, assigneeId: user.pat, transactionId: t7.id, completedDaysAgo: 10 });
  await task({ title: "Order more radon canisters (test)", due: 7, assigneeId: user.robin });
  await task({ title: "Update the service price list (test)", due: 14 });
  await task({ title: "Someday: try a new report layout (test)", due: null, assigneeId: user.lee });
  await task({ title: "Drop off sewer scope brochures", due: 4, assigneeId: user.pat, realtorId: r.quinn.id });
  await task({ title: "Check in after their unsubscribe", due: 9, assigneeId: user.pat, realtorId: r.drew.id });
  await task({ title: "Welcome to Sample Homes", due: -6, assigneeId: user.pat, realtorId: r.jamie.id, completedDaysAgo: 5 });

  // ------------------------------------------------------ communications
  const communication = async (d: Prisma.CommunicationUncheckedCreateInput) => {
    const row = await tx.communication.create({ data: d });
    count("communications");
    return row;
  };
  await communication({ transactionId: t2.id, realtorId: r.avery.id, channel: "Phone", direction: "OUTBOUND", summary: "Called Avery to confirm the inspection time.", occurredAt: ago(1) });
  await communication({ transactionId: t2.id, customerId: c.chris.id, channel: "Email", direction: "INBOUND", summary: "Chris asked whether radon results come with the report.", occurredAt: ago(2) });
  await communication({ transactionId: t5.id, customerId: c.gale.id, inspectionId: i5.id, channel: "In Person", direction: "OUTBOUND", summary: "Walked Gale through the major findings at the end of the inspection.", occurredAt: at(-3, "13:20") });
  await communication({ realtorId: r.quinn.id, channel: "Text", direction: "OUTBOUND", summary: "Sent Quinn an intro text about the sewer scope add-on.", occurredAt: ago(6) });
  await communication({ realtorId: r.jamie.id, channel: "Phone", direction: "INBOUND", summary: "Jamie called to say they moved to Sample Homes Brokerage.", occurredAt: ago(7) });
  await communication({ transactionId: t8.id, customerId: c.kai.id, channel: "Phone", direction: "INBOUND", summary: "Kai called to cancel; the buyer backed out of the contract.", occurredAt: ago(2) });
  await communication({ transactionId: t4.id, realtorId: r.morgan.id, channel: "Text", direction: "INBOUND", summary: "Morgan asked when the report will be ready.", occurredAt: ago(0) });

  // ----------------------------------------------------------- documents
  const document = async (transactionId: string, title: string, fileName: string, fileType: string, bytes: () => Promise<Buffer> | Buffer) => {
    const storageKey = `${transactionId}/${randomUUID()}-${fileName}`;
    await tx.document.create({ data: { transactionId, title, storageKey, fileType, uploadedById: user.pat } });
    pendingFiles.push({ dest: path.join(UPLOAD_ROOT, storageKey), bytes });
    count("documents");
  };
  await document(t2.id, "Purchase agreement (test)", "purchase-agreement.pdf", "application/pdf", () => testPdf("Purchase agreement", "101 Testing Ln, Hickory, NC"));
  await document(t5.id, "Inspection agreement — signed (test)", "inspection-agreement.pdf", "application/pdf", () => testPdf("Inspection agreement (signed)", "505 Mockingbird Test Rd, Morganton, NC"));
  await document(t6.id, "Seller disclosure (test)", "seller-disclosure.txt", "text/plain", () => Buffer.from(`Seller disclosure — 606 Placeholder Pl\n\n${NOTE}\n`));
  await document(t5.id, "Front of house photo (test)", "front.png", "image/png", () => testImage(42));

  // ------------------------------------------------------- email history
  const templateByKey = new Map((await tx.emailTemplate.findMany()).map((t) => [t.key, t]));
  const automationByKey = new Map((await tx.automation.findMany()).map((a) => [a.key, a]));
  const email = async (d: {
    templateKey: string;
    to: { type: EmailRecipientType; name: string; email: string | null };
    refs: EmailRefs;
    status: EmailStatus;
    mode?: EmailSendMode;
    when: Date;
    reason?: string;
    automationKey?: string;
    campaignId?: string;
    idempotencyKey?: string;
  }) => {
    const template = templateByKey.get(d.templateKey);
    if (!template) throw new Error(`Email template ${d.templateKey} is missing.`);
    const vars = await loadEmailVariables(d.refs, { now: d.when, db: tx as never });
    const rendered = renderSubjectAndBody(template.subject, template.body, vars);
    const went = ["SENT", "DELIVERED", "BOUNCED"].includes(d.status);
    const comm = went
      ? await tx.communication.create({ data: { channel: "Email", direction: "OUTBOUND", summary: rendered.subject, occurredAt: d.when, transactionId: d.refs.transactionId, realtorId: d.refs.realtorId, customerId: d.refs.customerId, inspectionId: d.refs.inspectionId } })
      : null;
    const automation = d.automationKey ? automationByKey.get(d.automationKey) : undefined;
    const message = await tx.emailMessage.create({
      data: {
        status: d.status,
        mode: d.mode ?? "AUTOMATIC",
        category: template.category,
        statusReason: d.reason ?? (went ? SENT_REASON : null),
        recipientType: d.to.type,
        recipientName: d.to.name,
        recipientEmail: d.to.email,
        subject: rendered.subject,
        bodyText: rendered.body,
        templateId: template.id,
        automationId: automation?.id,
        campaignId: d.campaignId,
        customerId: d.refs.customerId,
        realtorId: d.refs.realtorId,
        transactionId: d.refs.transactionId,
        inspectionId: d.refs.inspectionId,
        invoiceId: d.refs.invoiceId,
        reportDeliveryId: d.refs.reportDeliveryId,
        idempotencyKey: d.idempotencyKey,
        queuedAt: d.status === "DRAFT" ? null : d.when,
        sentAt: went ? d.when : null,
        deliveredAt: d.status === "DELIVERED" ? new Date(d.when.getTime() + 60_000) : null,
        bouncedAt: d.status === "BOUNCED" ? new Date(d.when.getTime() + 120_000) : null,
        failedAt: d.status === "FAILED" ? d.when : null,
        cancelledAt: d.status === "CANCELLED" ? d.when : null,
        attempts: d.status === "FAILED" ? 3 : went ? 1 : 0,
        provider: went || d.status === "FAILED" ? "log" : null,
        simulated: true,
        communicationId: comm?.id,
        createdById: d.mode === "MANUAL" ? user.pat : null,
        createdAt: d.when,
      },
    });
    if (d.status === "DELIVERED" || d.status === "BOUNCED") {
      await tx.emailEvent.create({
        data: {
          emailMessageId: message.id,
          provider: "postmark",
          eventKey: `test-data:${message.id}`,
          type: d.status,
          occurredAt: d.status === "DELIVERED" ? message.deliveredAt! : message.bouncedAt!,
          detail: { testData: true, ...(d.status === "BOUNCED" ? { description: "Unknown user (test data)" } : {}) },
        },
      });
      count("email events");
    }
    if (automation) {
      await tx.automationEvent.create({ data: { automationId: automation.id, entityType: d.refs.inspectionId ? "Inspection" : d.refs.invoiceId ? "Invoice" : d.refs.reportDeliveryId ? "ReportDelivery" : "Realtor", entityId: d.refs.inspectionId ?? d.refs.invoiceId ?? d.refs.reportDeliveryId ?? d.refs.realtorId ?? "", result: d.status, detail: { emailMessageId: message.id, testData: true }, firedAt: d.when } });
      count("automation events");
    }
    count("email messages");
    return message;
  };
  const galeTo = { type: "CUSTOMER" as const, name: "Gale Fixturely", email: c.gale.email };
  const i5Refs = { customerId: c.gale.id, transactionId: t5.id, inspectionId: i5.id };
  await email({ templateKey: "inspection_confirmation", to: galeTo, refs: i5Refs, status: "DELIVERED", when: ago(10), automationKey: "inspection_confirmation" });
  await email({ templateKey: "inspection_confirmation_realtor", to: { type: "REALTOR", name: "Avery Testwell", email: "avery.testwell@example.com" }, refs: { realtorId: r.avery.id, transactionId: t5.id, inspectionId: i5.id }, status: "DELIVERED", when: ago(10), automationKey: "inspection_confirmation" });
  await email({ templateKey: "inspection_reminder", to: galeTo, refs: i5Refs, status: "DELIVERED", when: ago(4), automationKey: "inspection_reminder" });
  await email({ templateKey: "report_ready", to: { type: "REALTOR", name: "Avery Testwell", email: "avery.testwell@example.com" }, refs: { realtorId: r.avery.id, transactionId: t5.id, inspectionId: i5.id, reportDeliveryId: r5Realtor.id }, status: "DELIVERED", when: ago(2), automationKey: "report_ready", idempotencyKey: `report-delivery:${r5Realtor.id}` });
  await email({ templateKey: "payment_reminder", to: { type: "CUSTOMER", name: "Harper Mockley", email: c.harper.email }, refs: { customerId: c.harper.id, transactionId: t6.id, invoiceId: inv7.id }, status: "BOUNCED", when: ago(5), automationKey: "payment_reminder" });
  await email({ templateKey: "customer_message", to: { type: "CUSTOMER", name: "Indy Testseller", email: c.indy.email }, refs: { customerId: c.indy.id, transactionId: t6.id }, status: "FAILED", mode: "MANUAL", when: ago(6), reason: "Provider error after 3 attempts (test data)" });
  await email({ templateKey: "inspection_reminder", to: { type: "CUSTOMER", name: "Kai Cancelson", email: c.kai.email }, refs: { customerId: c.kai.id, transactionId: t8.id, inspectionId: i8.id }, status: "CANCELLED", when: ago(2), reason: "Inspection cancelled", automationKey: "inspection_reminder" });
  await email({ templateKey: "realtor_follow_up", to: { type: "REALTOR", name: "Drew Fakename", email: "drew.fakename@example.com" }, refs: { realtorId: r.drew.id }, status: "SUPPRESSED", mode: "MANUAL", when: ago(15), reason: "Relationship emails are turned off for this Realtor" });
  await email({ templateKey: "customer_message", to: { type: "CUSTOMER", name: "Elliot Sampleperson", email: c.elliot.email }, refs: { customerId: c.elliot.id, transactionId: t3.id }, status: "DRAFT", mode: "MANUAL", when: ago(0) });
  await email({ templateKey: "inspection_confirmation", to: { type: "CUSTOMER", name: "Jules Closedeal", email: c.jules.email }, refs: { customerId: c.jules.id, transactionId: t7.id, inspectionId: i7.id }, status: "SENT", when: ago(50), automationKey: "inspection_confirmation" });

  // ----------------------------------------------------------- campaigns
  const campaign = async (d: { name: string; templateKey: string; status: Prisma.EmailCampaignUncheckedCreateInput["status"]; audience: Record<string, unknown>; extra?: Partial<Prisma.EmailCampaignUncheckedCreateInput> }) => {
    const template = templateByKey.get(d.templateKey)!;
    const row = await tx.emailCampaign.create({
      data: {
        name: d.name,
        category: template.category,
        templateId: template.id,
        subject: template.subject,
        body: template.body,
        audience: { brokerageIds: [], cities: [], activeWithinMonths: null, realtorIds: [], ...d.audience } as Prisma.InputJsonValue,
        status: d.status,
        createdById: user.pat,
        ...d.extra,
      },
    });
    count("campaigns");
    return row;
  };
  const launch = await campaign({
    name: "Sewer scope launch (test)",
    templateKey: "new_service_announcement",
    status: "COMPLETED",
    audience: { realtorIds: [r.quinn.id, r.jamie.id] },
    extra: { submittedAt: ago(12), approvedAt: ago(11), approvedById: user.pat, startedAt: ago(11), completedAt: ago(11) },
  });
  for (const [re, name, addr] of [
    [r.quinn, "Quinn Placeholder", "quinn.placeholder@example.com"],
    [r.jamie, "Jamie Movedover", "jamie.movedover@example.com"],
  ] as const) {
    await email({ templateKey: "new_service_announcement", to: { type: "REALTOR", name, email: addr }, refs: { realtorId: re.id }, status: "DELIVERED", when: ago(11), campaignId: launch.id });
  }
  await campaign({ name: "Winter maintenance tips (test)", templateKey: "realtor_educational", status: "DRAFT", audience: { cities: ["Hickory"] } });
  await campaign({ name: "Boone agents check-in (test)", templateKey: "realtor_educational", status: "READY_FOR_REVIEW", audience: { brokerageIds: [mvr.id] }, extra: { submittedAt: ago(0) } });
  await campaign({ name: "Fall open house (test)", templateKey: "new_service_announcement", status: "CANCELLED", audience: { activeWithinMonths: 12 }, extra: { submittedAt: ago(9), cancelledAt: ago(7) } });

  // ------------------------------------------------- suppressions & templates
  await tx.emailSuppression.create({ data: { email: c.harper.email!, scope: "ALL", reason: "Hard bounce: Unknown user (test data)", source: "postmark-webhook" } });
  await tx.emailSuppression.create({ data: { email: "drew.fakename@example.com", scope: "MARKETING", reason: "Unsubscribed from marketing (test data)", source: "unsubscribe-link" } });
  await tx.emailSuppression.create({ data: { email: "do-not-email@example.com", scope: "NON_TRANSACTIONAL", reason: "Asked not to be emailed (test data)", source: "manual", createdById: user.pat } });
  count("email suppressions", 3);
  await tx.emailTemplate.create({
    data: {
      key: "test_quick_check_in",
      name: "Quick check-in (test)",
      description: NOTE,
      category: "RELATIONSHIP",
      recipientType: "REALTOR",
      subject: "Checking in, {{realtor.firstName}}",
      body: "Hi {{realtor.firstName}},\n\nJust checking in to see if any of your buyers need an inspection soon.\n\n{{company.signature | \"Thank you,\"}}\n{{company.name}}",
      createdById: user.pat,
    },
  });
  count("email templates");

  // -------------------------------------------------------- custom fields
  const field = (entityType: Prisma.CustomFieldDefinitionUncheckedCreateInput["entityType"], fieldKey: string, label: string, dataType: Prisma.CustomFieldDefinitionUncheckedCreateInput["dataType"], extra: Partial<Prisma.CustomFieldDefinitionUncheckedCreateInput> = {}) =>
    tx.customFieldDefinition.create({ data: { entityType, fieldKey, label, dataType, ...extra } });
  const fields = {
    foundation: await field("PROPERTY", "test_foundation_type", "Foundation type (test)", "SELECT", { options: ["Slab", "Crawlspace", "Basement"] }),
    pool: await field("PROPERTY", "test_has_pool", "Has a pool (test)", "BOOLEAN", { displayOrder: 1 }),
    gate: await field("INSPECTION", "test_gate_code", "Gate code (test)", "TEXT"),
    firstTime: await field("CUSTOMER", "test_first_time_buyer", "First-time buyer (test)", "BOOLEAN"),
    loan: await field("TRANSACTION", "test_loan_type", "Loan type (test)", "SELECT", { options: ["Conventional", "FHA", "VA", "Cash"], required: true }),
    cost: await field("FINDING", "test_estimated_cost", "Estimated repair cost (test)", "NUMBER"),
    built: await field("PROPERTY", "test_last_renovated", "Last renovated (test)", "DATE", { displayOrder: 2 }),
    tags: await field("REPORT", "test_report_tags", "Report tags (test)", "MULTISELECT", { options: ["Pre-listing", "New construction", "Rush"], active: false }),
  };
  count("custom field definitions", Object.keys(fields).length);
  const value = async (def: { id: string; entityType: Prisma.CustomFieldDefinitionUncheckedCreateInput["entityType"] }, entityId: string, v: string | number | boolean | Date | string[]) => {
    await tx.customFieldValue.create({
      data: {
        fieldDefinitionId: def.id,
        entityType: def.entityType,
        entityId,
        value: (v instanceof Date ? v.toISOString() : v) as Prisma.InputJsonValue,
        valueText: typeof v === "string" ? v : Array.isArray(v) ? v.join(", ") : null,
        valueNumber: typeof v === "number" ? v : null,
        valueDate: v instanceof Date ? v : null,
      },
    });
    count("custom field values");
  };
  await value(fields.foundation, p.p1.id, "Crawlspace");
  await value(fields.foundation, p.p5.id, "Basement");
  await value(fields.pool, p.p1.id, false);
  await value(fields.pool, p.p3.id, true);
  await value(fields.built, p.p4.id, new Date("2012-05-01"));
  await value(fields.gate, i2.id, "1234#");
  await value(fields.firstTime, c.chris.id, true);
  await value(fields.loan, t2.id, "FHA");
  await value(fields.loan, t5.id, "Cash");
  for (const ec of estimatedCosts) await value(fields.cost, ec.findingId, ec.amount);
  await value(fields.tags, r5.id, ["Rush"]);

  // ------------------------------------------------------- saved reports
  const savedReport = async (ownerId: string, name: string, shared: boolean, config: Record<string, unknown>) => {
    await tx.reportDefinition.create({ data: { ownerId, name, shared, entity: config.entity as string, config: { columns: [], filters: [], groupBy: [], aggregations: [], ...config } as Prisma.InputJsonValue } });
    count("saved reports");
  };
  await savedReport(user.lee, "Inspections by status (test)", true, { entity: "Inspection", groupBy: ["status"], aggregations: [{ fieldKey: "id", fn: "count" }] });
  await savedReport(user.lee, "Open transactions (test)", true, { entity: "Transaction", columns: [{ fieldKey: "status" }, { fieldKey: "closingDate" }, { fieldKey: "property.city" }], filters: [{ fieldKey: "status", operator: "not", value: "CLOSED" }], sortField: "closingDate", sortDirection: "asc" });
  await savedReport(user.lee, "Homes by year built (test)", true, { entity: "Property", columns: [{ fieldKey: "city" }, { fieldKey: "yearBuilt" }, { fieldKey: "squareFootage" }], sortField: "yearBuilt", sortDirection: "asc" });
  await savedReport(user.pat, "Leads by status (test, private)", false, { entity: "Lead", groupBy: ["status"], aggregations: [{ fieldKey: "id", fn: "count" }] });

  await logActivity(tx, { action: MARKER, entityType: "System", entityId: SOURCE, after: { counts, ranAt: now.toISOString() } });

  return { counts, scheduledInspectionIds: [i2.id, i3.id, i9.id, i10.id], completedInspectionId: i5.id };
}

// The same snapshot finalizeReport stores (src/app/(app)/inspections/report-actions.ts).
async function buildSnapshot(tx: Tx, reportId: string, versionNumber: number, finalizedAt: Date, reasonForRevision: string | null): Promise<ReportSnapshot> {
  const report = await tx.inspectionReport.findUniqueOrThrow({
    where: { id: reportId },
    include: {
      inspection: { include: { property: true, inspector: true, transaction: { include: { customers: { include: { customer: true }, orderBy: { createdAt: "asc" } } } } } },
      sections: { orderBy: { displayOrder: "asc" }, include: { components: { orderBy: { displayOrder: "asc" }, include: { findings: { include: { category: true }, orderBy: { displayOrder: "asc" } } } } } },
    },
  });
  const summaryItems = await tx.reportSummaryItem.findMany({ where: { reportId }, orderBy: { displayOrder: "asc" } });
  const primary = report.inspection.transaction.customers.find((tc) => tc.primaryContact)?.customer ?? report.inspection.transaction.customers[0]?.customer;
  return {
    reportNumber: report.reportNumber,
    title: report.title,
    introduction: report.introduction,
    scope: report.scope,
    limitations: report.limitations,
    footer: report.footer,
    customerFacingNotes: report.customerFacingNotes,
    property: report.inspection.property,
    inspectorName: report.inspection.inspector?.name ?? null,
    customerName: primary ? `${primary.firstName} ${primary.lastName}` : null,
    inspectionDate: (report.inspection.completedAt ?? report.inspection.scheduledAt)?.toISOString() ?? null,
    finalizedAt: finalizedAt.toISOString(),
    versionNumber,
    reasonForRevision,
    sections: report.sections.map((s) => ({
      name: s.name,
      notApplicable: s.notApplicable,
      components: s.components.map((comp) => ({
        name: comp.name,
        inspectionStatus: comp.inspectionStatus,
        limitationNote: comp.limitationNote,
        notes: comp.notes,
        findings: comp.findings.map((f) => ({
          id: f.id,
          title: f.title,
          description: f.description,
          location: f.location,
          category: f.category?.label ?? null,
          recommendation: f.recommendation,
          safetyRelated: f.safetyRelated,
          repairRecommended: f.repairRecommended,
          monitor: f.monitor,
          furtherEvaluation: f.furtherEvaluation,
        })),
      })),
    })),
    summary: summaryItems.map((item) => ({ groupLabel: item.groupLabel, findingId: item.findingId })),
  } as ReportSnapshot;
}

// A small striped PNG, a different color per photo, so photos are tell-apart-able.
function testImage(seedNo: number): Buffer {
  const width = 480;
  const height = 360;
  const hue = (seedNo * 47) % 360;
  const [r0, g0, b0] = hsl(hue, 0.45, 0.55);
  const [r1, g1, b1] = hsl(hue, 0.45, 0.4);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const stripe = Math.floor((x + y) / 40) % 2 === 0 || y > height - 60;
      const o = row + 1 + x * 3;
      raw[o] = stripe ? r1 : r0;
      raw[o + 1] = stripe ? g1 : g0;
      raw[o + 2] = stripe ? b1 : b0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)];
}

function testPdf(title: string, subtitle: string): Promise<Buffer> {
  const doc = createElement(
    Document,
    null,
    createElement(Page, { size: "LETTER", style: { padding: 48 } }, createElement(Text, { style: { fontSize: 20, marginBottom: 12 } }, `${title} (test)`), createElement(Text, null, subtitle), createElement(Text, { style: { marginTop: 24, color: "#666" } }, NOTE))
  ) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(doc);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
