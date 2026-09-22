"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import type { Role } from "@prisma/client";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

// Only customerId is truly required — property, referral source, and realtor
// can all be added later without blocking transaction creation (§7).
export async function createTransaction(formData: FormData) {
  const customerId = String(formData.get("customerId") ?? "").trim();
  const propertyId = String(formData.get("propertyId") ?? "").trim() || null;
  const referralSourceId = String(formData.get("referralSourceId") ?? "").trim() || null;

  if (!customerId) throw new Error("A customer is required.");

  const transaction = await prisma.transaction.create({
    data: { customerId, propertyId, referralSourceId, status: "LEAD_IN_PROGRESS" },
  });

  revalidatePath("/transactions");
  redirect(`/transactions/${transaction.id}`);
}

export async function addParticipant(transactionId: string, formData: FormData) {
  const realtorId = String(formData.get("realtorId") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  if (!realtorId || !role) throw new Error("Realtor and role are required.");

  await prisma.transactionParticipant.create({
    data: { transactionId, realtorId, role: role as never },
  });
  revalidatePath(`/transactions/${transactionId}`);
}

export async function setTransactionProperty(transactionId: string, formData: FormData) {
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
// Access is gated through /api/documents/[id], which checks for a staff
// session before streaming bytes back (§ "File/Document Security").
export async function uploadDocument(transactionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("A file is required.");

  const title = String(formData.get("title") ?? "").trim() || file.name;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `${transactionId}/${randomUUID()}-${safeName}`;
  const destination = path.join(UPLOAD_ROOT, storageKey);

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await file.arrayBuffer()));

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
