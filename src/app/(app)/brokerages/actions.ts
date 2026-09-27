"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { digitsOnly, isValidPhoneInput } from "@/lib/phone";
import type { Role } from "@prisma/client";

export interface NewBrokerageInput {
  name: string;
  phone: string;
  email: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  // Set after the user has seen the possible duplicates and chosen to go ahead.
  confirmDuplicates?: boolean;
}

export interface BrokerageDuplicate {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  reason: "name" | "phone";
}

export type CreateBrokerageResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string }
  | { ok: false; duplicates: BrokerageDuplicate[] };

// Only the name is required. Likely duplicates (same name, or same phone)
// are shown for a person to judge — nothing is merged, and "Create anyway"
// is always available.
export async function createBrokerageQuick(input: NewBrokerageInput): Promise<CreateBrokerageResult> {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const clean = (v: string) => v.trim() || null;
  const name = clean(input.name);
  if (!name) return { ok: false, error: "Brokerage name is required." };
  if (!isValidPhoneInput(input.phone)) return { ok: false, error: "Phone number must have 10 digits." };
  const email = clean(input.email);
  if (email && !z.email().safeParse(email).success) return { ok: false, error: "That email address doesn't look valid." };
  const state = clean(input.state)?.toUpperCase() ?? null;
  if (state && !/^[A-Z]{2}$/.test(state)) return { ok: false, error: "State should be a 2-letter code, like NC." };
  const phone = clean(input.phone) ? digitsOnly(input.phone) : null;

  if (!input.confirmDuplicates) {
    const matches = await prisma.brokerage.findMany({
      where: { archivedAt: null, OR: [{ name: { equals: name, mode: "insensitive" } }, ...(phone ? [{ phone }] : [])] },
      select: { id: true, name: true, phone: true, city: true, state: true },
      take: 5,
    });
    if (matches.length > 0) {
      return {
        ok: false,
        duplicates: matches.map((m) => ({ ...m, reason: m.name.toLowerCase() === name.toLowerCase() ? "name" : "phone" })),
      };
    }
  }

  const brokerage = await prisma.brokerage.create({
    data: { name, phone, email, addressLine1: clean(input.addressLine1), city: clean(input.city), state, zip: clean(input.zip) },
  });
  await logActivity(prisma, { actorId: session?.user?.id, action: "brokerage.created", entityType: "Brokerage", entityId: brokerage.id });
  revalidatePath("/brokerages");
  return { ok: true, data: { id: brokerage.id } };
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
