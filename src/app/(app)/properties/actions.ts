"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import type { Role } from "@prisma/client";

export async function createProperty(formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

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

// Called directly from client code (not a <form action>) by a property
// Combobox's "+ Add new property" popup, so it takes a plain object and
// hands back the created row's id/label to select immediately — see
// createBrokerageInline for the same pattern.
export async function createPropertyInline(data: { addressLine1: string; city: string; state: string; zip: string }) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const addressLine1 = data.addressLine1.trim();
  const city = data.city.trim();
  const state = data.state.trim();
  const zip = data.zip.trim();
  if (!addressLine1 || !city || !state || !zip) throw new Error("Address, city, state, and zip are required.");

  const property = await prisma.property.create({ data: { addressLine1, city, state, zip } });
  revalidatePath("/properties");
  return { id: property.id, label: `${property.addressLine1}, ${property.city}` };
}
