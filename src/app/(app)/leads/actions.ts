"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
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

// Converting a lead never requires anything beyond the lead itself — property,
// realtor, and referral source can all be filled in later on the transaction (§7).
export async function convertLead(leadId: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  const result = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
      },
    });

    await tx.lead.update({
      where: { id: leadId },
      data: { status: "CONVERTED", convertedCustomerId: customer.id, convertedAt: new Date() },
    });

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

  revalidatePath("/leads");
  redirect(`/transactions/${result.transactionId}`);
}
