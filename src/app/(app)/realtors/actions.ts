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
