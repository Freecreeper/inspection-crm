"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function createBrokerage(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;

  if (!name) throw new Error("Brokerage name is required.");

  await prisma.brokerage.create({ data: { name, phone, email } });
  revalidatePath("/brokerages");
}
