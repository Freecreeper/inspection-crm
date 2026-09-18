"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

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
