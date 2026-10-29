"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { isSettableLeadStatus } from "@/lib/leads/pipeline";
import type { Role } from "@prisma/client";

export async function createLead(formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!firstName || !lastName) {
    throw new Error("First and last name are required.");
  }

  await prisma.lead.create({ data: { firstName, lastName, email, phone, notes } });
  revalidatePath("/leads");
  redirect("/leads");
}

// Moves a lead along the pipeline (bound to the lead id; the form posts
// `status`). Only the statuses staff may set by hand are accepted —
// Converted comes from convertLead — and a converted lead is never moved.
export async function setLeadStatus(leadId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");
  const status = formData.get("status");
  if (!isSettableLeadStatus(status)) throw new Error("That isn't a status a lead can be moved to.");

  await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { status: true } });
    if (!lead || lead.status === "CONVERTED" || lead.status === status) return;
    await tx.lead.update({ where: { id: leadId }, data: { status } });
    await logActivity(tx, { actorId: session?.user?.id, action: "lead.status_changed", entityType: "Lead", entityId: leadId, before: { status: lead.status }, after: { status } });
  });
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
}

// Converting a lead never requires anything beyond the lead itself — property,
// realtor, and referral source can all be filled in later on the transaction (§7).
export async function convertLead(leadId: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  const result = await prisma.$transaction(async (tx) => {
    // Claim the lead first, atomically. A second click (or a second tab)
    // finds it already converted and goes to that conversion instead of
    // creating another customer and transaction.
    const { count } = await tx.lead.updateMany({ where: { id: leadId, status: { not: "CONVERTED" } }, data: { status: "CONVERTED", convertedAt: new Date() } });
    if (count === 0) return null;

    const customer = await tx.customer.create({
      data: {
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
      },
    });

    await tx.lead.update({ where: { id: leadId }, data: { convertedCustomerId: customer.id } });

    const transaction = await tx.transaction.create({
      data: { referralSourceId: lead.referralSourceId, status: "LEAD_IN_PROGRESS" },
    });

    // The converted lead becomes the primary contact — a lead only ever
    // represents one person, so PRIMARY_BUYER is the only sensible default;
    // staff can add a second customer (e.g. a co-buyer) from the transaction.
    await tx.transactionCustomer.create({
      data: {
        transactionId: transaction.id,
        customerId: customer.id,
        role: "PRIMARY_BUYER",
        primaryContact: true,
      },
    });

    return { customerId: customer.id, transactionId: transaction.id };
  });

  if (!result) {
    // Re-read: the conversion that won may have committed after our first read.
    const converted = await prisma.lead.findUnique({ where: { id: leadId }, select: { convertedCustomerId: true } });
    const existing = converted?.convertedCustomerId
      ? await prisma.transactionCustomer.findFirst({ where: { customerId: converted.convertedCustomerId }, orderBy: { createdAt: "asc" }, select: { transactionId: true } })
      : null;
    redirect(existing ? `/transactions/${existing.transactionId}` : `/leads/${leadId}`);
  }

  revalidatePath("/leads");
  redirect(`/transactions/${result.transactionId}`);
}
