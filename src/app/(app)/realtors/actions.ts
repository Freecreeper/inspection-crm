"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function createRealtor(formData: FormData) {
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const brokerageId = String(formData.get("brokerageId") ?? "").trim() || null;

  if (!firstName || !lastName) throw new Error("First and last name are required.");

  await prisma.realtor.create({ data: { firstName, lastName, email, phone, brokerageId } });
  revalidatePath("/realtors");
}

// Moving a realtor to a new brokerage closes out the open history row rather
// than overwriting it, so a transaction from six months ago still shows the
// brokerage that was actually current at the time (§4, RealtorBrokerageHistory).
export async function changeRealtorBrokerage(realtorId: string, formData: FormData) {
  const brokerageId = String(formData.get("brokerageId") ?? "").trim();
  if (!brokerageId) throw new Error("A brokerage is required.");

  const startDate = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.realtorBrokerageHistory.updateMany({
      where: { realtorId, endDate: null },
      data: { endDate: startDate },
    });
    await tx.realtorBrokerageHistory.create({
      data: { realtorId, brokerageId, startDate },
    });
    await tx.realtor.update({ where: { id: realtorId }, data: { brokerageId } });
  });

  revalidatePath(`/realtors/${realtorId}`);
  revalidatePath("/realtors");
}
