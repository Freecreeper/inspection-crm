"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import type { Role } from "@prisma/client";

// Creating a Realtor with an initial Brokerage opens a history row for it
// (PR #1 review item 5) — without this, a realtor created with a brokerage
// already set would have a "current" brokerage with no history behind it,
// and changeRealtorBrokerage's updateMany({ endDate: null }) would have
// nothing to close when they later moved.
export async function createRealtor(formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const brokerageId = String(formData.get("brokerageId") ?? "").trim() || null;

  if (!firstName || !lastName) throw new Error("First and last name are required.");

  await prisma.$transaction(async (tx) => {
    const realtor = await tx.realtor.create({ data: { firstName, lastName, email, phone, brokerageId } });
    if (brokerageId) {
      await tx.realtorBrokerageHistory.create({
        data: { realtorId: realtor.id, brokerageId, startDate: realtor.createdAt },
      });
    }
  });

  revalidatePath("/realtors");
  redirect("/realtors");
}

// Moving a realtor to a new brokerage closes out the open history row rather
// than overwriting it, so a transaction from six months ago still shows the
// brokerage that was actually current at the time (§4, RealtorBrokerageHistory).
export async function changeRealtorBrokerage(realtorId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

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
