"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export async function createLead(formData: FormData) {
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
      data: {
        customerId: customer.id,
        referralSourceId: lead.referralSourceId,
        status: "LEAD_IN_PROGRESS",
      },
    });

    return { customerId: customer.id, transactionId: transaction.id };
  });

  revalidatePath("/leads");
  redirect(`/transactions/${result.transactionId}`);
}
