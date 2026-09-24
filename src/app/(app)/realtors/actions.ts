"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { digitsOnly, isValidPhoneInput } from "@/lib/phone";
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
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const brokerageId = String(formData.get("brokerageId") ?? "").trim() || null;

  if (!firstName || !lastName) throw new Error("First and last name are required.");
  // Client-side already enforces this (formatted as you type, blocked on
  // submit), but the server is the real gate — a phone number is stored as
  // exactly 10 digits or not at all, never a partial/malformed value.
  if (!isValidPhoneInput(rawPhone)) throw new Error("Phone number must have 10 digits.");
  const phone = rawPhone ? digitsOnly(rawPhone) : null;

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

// Called directly from client code (not a <form action>) by a realtor
// Combobox's "+ Add new realtor" popup (e.g. while adding a realtor to a
// transaction) — see createBrokerageInline for the same pattern. Kept
// minimal (no brokerage picked here) so the popup stays quick; a brokerage
// can be set afterward from the realtor's own page.
export async function createRealtorInline(data: { firstName: string; lastName: string; phone: string }) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const firstName = data.firstName.trim();
  const lastName = data.lastName.trim();
  if (!firstName || !lastName) throw new Error("First and last name are required.");
  if (!isValidPhoneInput(data.phone)) throw new Error("Phone number must have 10 digits.");
  const phone = data.phone ? digitsOnly(data.phone) : null;

  const realtor = await prisma.realtor.create({ data: { firstName, lastName, phone } });
  revalidatePath("/realtors");
  return { id: realtor.id, label: `${realtor.firstName} ${realtor.lastName}` };
}

// The next three are called directly from client code (not a <form
// action>) by the Realtors table's inline, click-to-edit cells — same
// "plain args in, plain object/void out" shape as createRealtorInline.
// Kept as three narrow actions rather than one generic "updateRealtorField"
// because each cell has different validation (name can't be blank, phone
// must be 10 digits or empty) that's clearer spelled out per-field than
// looked up by a field-name string.
export async function updateRealtorNameInline(realtorId: string, data: { firstName: string; lastName: string }) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const firstName = data.firstName.trim();
  const lastName = data.lastName.trim();
  if (!firstName || !lastName) throw new Error("First and last name are required.");

  await prisma.realtor.update({ where: { id: realtorId }, data: { firstName, lastName } });
  revalidatePath("/realtors");
  revalidatePath(`/realtors/${realtorId}`);
}

export async function updateRealtorEmailInline(realtorId: string, email: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  await prisma.realtor.update({ where: { id: realtorId }, data: { email: email.trim() || null } });
  revalidatePath("/realtors");
  revalidatePath(`/realtors/${realtorId}`);
}

export async function updateRealtorPhoneInline(realtorId: string, phone: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");
  if (!isValidPhoneInput(phone)) throw new Error("Phone number must have 10 digits.");

  await prisma.realtor.update({ where: { id: realtorId }, data: { phone: phone ? digitsOnly(phone) : null } });
  revalidatePath("/realtors");
  revalidatePath(`/realtors/${realtorId}`);
}

// Moving a realtor to a new brokerage closes out the open history row rather
// than overwriting it, so a transaction from six months ago still shows the
// brokerage that was actually current at the time (§4, RealtorBrokerageHistory).
async function moveRealtorToBrokerage(realtorId: string, brokerageId: string) {
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

export async function changeRealtorBrokerage(realtorId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const brokerageId = String(formData.get("brokerageId") ?? "").trim();
  if (!brokerageId) throw new Error("A brokerage is required.");

  await moveRealtorToBrokerage(realtorId, brokerageId);
}

// Same as changeRealtorBrokerage but for the Realtors table's inline
// editable cell, which calls this directly (not through a <form>) via the
// Combobox's onSelect — see updateRealtorNameInline etc. for the same
// plain-args shape.
export async function changeRealtorBrokerageInline(realtorId: string, brokerageId: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");
  if (!brokerageId) throw new Error("A brokerage is required.");

  await moveRealtorToBrokerage(realtorId, brokerageId);
}
