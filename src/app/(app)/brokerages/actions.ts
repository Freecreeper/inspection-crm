"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { digitsOnly, isValidPhoneInput } from "@/lib/phone";
import type { Role } from "@prisma/client";

export async function createBrokerage(formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const text = (key: string) => String(formData.get(key) ?? "").trim() || null;
  const name = text("name");
  const rawPhone = text("phone") ?? "";

  if (!name) throw new Error("Brokerage name is required.");
  if (!isValidPhoneInput(rawPhone)) throw new Error("Phone number must have 10 digits.");

  await prisma.brokerage.create({
    data: {
      name,
      phone: rawPhone ? digitsOnly(rawPhone) : null,
      email: text("email"),
      addressLine1: text("addressLine1"),
      city: text("city"),
      state: text("state")?.toUpperCase() ?? null,
      zip: text("zip"),
    },
  });
  revalidatePath("/brokerages");
}

// Called directly from client code (not a <form action>) by the "add new
// brokerage" popup on the New Realtor form, so it takes a plain object
// instead of FormData and hands back the created row — the caller needs
// the new id to select it in the brokerage dropdown without a page reload.
export async function createBrokerageInline(data: { name: string; phone: string }) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const name = data.name.trim();
  if (!name) throw new Error("Brokerage name is required.");
  if (!isValidPhoneInput(data.phone)) throw new Error("Phone number must have 10 digits.");
  const phone = data.phone ? digitsOnly(data.phone) : null;

  const brokerage = await prisma.brokerage.create({ data: { name, phone } });
  revalidatePath("/brokerages");
  return { id: brokerage.id, name: brokerage.name };
}
