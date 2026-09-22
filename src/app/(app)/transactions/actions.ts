"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { validateUpload, safeFileName, scanForMalware } from "@/lib/documents";
import type { Role } from "@prisma/client";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

if (process.env.NODE_ENV === "production") {
  // eslint-disable-next-line no-console
  console.warn(
    "[documents] Storing uploads on local disk in production — this is a dev-only stand-in for object storage (§11, §17)."
  );
}

// Nothing is structurally required to create a Transaction (PR #1 review item
// 3) — not a customer, not a property, not a referral source. All of it can
// be attached afterward without blocking the record from existing. The only
// fields Transaction genuinely cannot exist without are its id/status/
// timestamps, which are all defaulted.
export async function createTransaction(formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const propertyId = String(formData.get("propertyId") ?? "").trim() || null;
  const referralSourceId = String(formData.get("referralSourceId") ?? "").trim() || null;
  const customerId = String(formData.get("customerId") ?? "").trim() || null;

  const transaction = await prisma.$transaction(async (tx) => {
    const created = await tx.transaction.create({
      data: { propertyId, referralSourceId, status: "LEAD_IN_PROGRESS" },
    });
    // A customer picked on the "new transaction" form becomes the primary
    // contact — optional, but the common case when staff already know who
    // they're creating the transaction for.
    if (customerId) {
      await tx.transactionCustomer.create({
        data: { transactionId: created.id, customerId, role: "PRIMARY_BUYER", primaryContact: true },
      });
    }
    return created;
  });

  revalidatePath("/transactions");
  redirect(`/transactions/${transaction.id}`);
}

// Adds a Customer to a Transaction without duplicating the Customer record
// (PR #1 review item 1). Marking a new addition primary demotes whichever
// row was primary before it — application-enforced, since Prisma has no
// partial-unique-index syntax to enforce "at most one primary" at the DB
// layer.
export async function addCustomerToTransaction(transactionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const customerId = String(formData.get("customerId") ?? "").trim();
  const role = String(formData.get("role") ?? "OTHER").trim();
  const makePrimary = String(formData.get("primaryContact") ?? "") === "true";
  if (!customerId) throw new Error("A customer is required.");

  await prisma.$transaction(async (tx) => {
    if (makePrimary) {
      await tx.transactionCustomer.updateMany({
        where: { transactionId, primaryContact: true },
        data: { primaryContact: false },
      });
    }
    await tx.transactionCustomer.create({
      data: { transactionId, customerId, role: role as never, primaryContact: makePrimary },
    });
  });

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath(`/customers/${customerId}`);
}

export async function setPrimaryCustomer(transactionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const transactionCustomerId = String(formData.get("transactionCustomerId") ?? "").trim();
  if (!transactionCustomerId) throw new Error("A customer is required.");

  await prisma.$transaction(async (tx) => {
    // Both updates are scoped by transactionId (not just id) so a
    // transactionCustomerId for a *different* transaction can never flip a
    // row it doesn't belong to — the row's own transaction keeps whichever
    // primary it already had.
    await tx.transactionCustomer.updateMany({
      where: { transactionId, primaryContact: true },
      data: { primaryContact: false },
    });
    const { count } = await tx.transactionCustomer.updateMany({
      where: { id: transactionCustomerId, transactionId },
      data: { primaryContact: true },
    });
    if (count === 0) throw new Error("That customer is not on this transaction.");
  });

  revalidatePath(`/transactions/${transactionId}`);
}

// Realtor-specific (PR #1 review item 2) — the old addParticipant let any
// role including BUYER/SELLER attach to a nullable realtorId, which meant a
// "BUYER" participant row could exist with no actual buyer behind it.
// Customer-side participants go through addCustomerToTransaction instead.
export async function addRealtorToTransaction(transactionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const realtorId = String(formData.get("realtorId") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  if (!realtorId || !role) throw new Error("Realtor and role are required.");

  const realtor = await prisma.realtor.findUniqueOrThrow({
    where: { id: realtorId },
    include: { brokerage: true },
  });

  await prisma.transactionRealtor.create({
    data: {
      transactionId,
      realtorId,
      role: role as never,
      // Snapshot, not a live lookup (§ schema comment on TransactionRealtor) —
      // "the brokerage at the time of the transaction" has no single instant
      // to resolve against; "the brokerage when this realtor was actually
      // attached to this deal" does.
      brokerageId: realtor.brokerageId,
      brokerageName: realtor.brokerage?.name ?? null,
    },
  });
  revalidatePath(`/transactions/${transactionId}`);
}

export async function setTransactionProperty(transactionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const propertyId = String(formData.get("propertyId") ?? "").trim();
  if (!propertyId) throw new Error("A property is required.");

  await prisma.transaction.update({ where: { id: transactionId }, data: { propertyId } });
  revalidatePath(`/transactions/${transactionId}`);
}

// Communication history is append-only — a logged call or email is a fact
// about what happened, never edited or deleted after the fact (§ "Relationship
// Management" / "Communication History").
export async function addCommunication(transactionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const channel = String(formData.get("channel") ?? "").trim();
  const direction = String(formData.get("direction") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();

  if (!channel || !direction || !summary) {
    throw new Error("Channel, direction, and summary are required.");
  }

  await prisma.communication.create({ data: { transactionId, channel, direction, summary } });
  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/communications");
}

// Files live outside /public — nothing here is served by a bare static URL.
// Access is gated through /api/documents/[id] (PR #1 review item 7), which
// checks the document:read permission (not just "is there a session") before
// streaming bytes back — see ReportDelivery for the separate signed-token
// path used for external, non-staff recipients.
export async function uploadDocument(transactionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction) throw new Error("Transaction not found.");

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("A file is required.");

  const validation = validateUpload(file);
  if (!validation.ok) throw new Error(validation.error);

  const buffer = Buffer.from(await file.arrayBuffer());
  const scan = await scanForMalware(buffer);
  if (!scan.clean) throw new Error("File failed a security scan.");

  const title = String(formData.get("title") ?? "").trim() || file.name;
  const storageKey = `${transactionId}/${randomUUID()}-${safeFileName(file.name)}`;
  const destination = path.join(UPLOAD_ROOT, storageKey);

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, buffer);

  await prisma.document.create({
    data: {
      transactionId,
      title,
      storageKey,
      fileType: file.type || "application/octet-stream",
      uploadedById: session?.user?.id ?? null,
    },
  });

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/documents");
}
