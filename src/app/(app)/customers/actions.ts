"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { digitsOnly, isValidPhoneInput } from "@/lib/phone";

export type SaveResult = { ok: true } | { ok: false; error: string };

// One contact field at a time (the inline "Add email" flow). Blank clears
// it — a customer without an email is still a complete record.
export async function updateCustomerContact(customerId: string, field: "email" | "phone", value: string): Promise<SaveResult> {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");
  const trimmed = value.trim();

  let next: string | null = trimmed || null;
  if (field === "email" && next && !z.email().safeParse(next).success) return { ok: false, error: "That email address doesn't look valid." };
  if (field === "phone") {
    if (!isValidPhoneInput(trimmed)) return { ok: false, error: "Phone number must have 10 digits." };
    next = trimmed ? digitsOnly(trimmed) : null;
  }

  const before = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!before) return { ok: false, error: "Customer not found." };
  await prisma.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: customerId }, data: { [field]: next } });
    await logActivity(tx, {
      actorId: session?.user?.id,
      action: "customer.contact_updated",
      entityType: "Customer",
      entityId: customerId,
      before: { [field]: before[field] },
      after: { [field]: next },
    });
  });
  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}
