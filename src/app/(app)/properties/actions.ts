"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function createProperty(formData: FormData) {
  const addressLine1 = String(formData.get("addressLine1") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const zip = String(formData.get("zip") ?? "").trim();
  const yearBuiltRaw = String(formData.get("yearBuilt") ?? "").trim();
  const squareFootageRaw = String(formData.get("squareFootage") ?? "").trim();

  if (!addressLine1 || !city || !state || !zip) {
    throw new Error("Address, city, state, and zip are required.");
  }

  await prisma.property.create({
    data: {
      addressLine1,
      city,
      state,
      zip,
      yearBuilt: yearBuiltRaw ? Number(yearBuiltRaw) : null,
      squareFootage: squareFootageRaw ? Number(squareFootageRaw) : null,
    },
  });
  revalidatePath("/properties");
}
