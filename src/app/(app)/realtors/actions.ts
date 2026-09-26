"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan, type Permission } from "@/lib/rbac";
import { digitsOnly, isValidPhoneInput } from "@/lib/phone";
import { parseDateInput } from "@/lib/dates";
import { logActivity } from "@/lib/activity";
import { isCommunicationChannel, isCommunicationDirection } from "@/lib/communications";
import { findRealtorDuplicates, type DuplicateCandidate } from "@/lib/realtors/duplicates";
import { loadRealtorPreview, type RealtorPreview } from "@/lib/realtors/preview";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

// Role checks throw (a legitimate UI never offers the action, so reaching
// here without permission is not a user-correctable mistake). Validation
// problems come back as { ok: false, error } instead — Next redacts thrown
// server-action messages in production, so a thrown "Phone number must have
// 10 digits" would reach the user as a generic failure.
async function requireSession(permission?: Permission) {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  const role = session.user.role as Role | undefined;
  if (permission) assertCan(role, permission);
  return { role, userId: session.user.id ?? null };
}

function revalidateRealtor(realtorId: string) {
  revalidatePath("/realtors");
  revalidatePath(`/realtors/${realtorId}`);
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface NewRealtorInput {
  firstName: string;
  lastName: string;
  preferredName?: string;
  email?: string;
  phone?: string;
  brokerageId?: string;
  // Set once the user has reviewed the possible matches and chosen to
  // create anyway. Without it, any match stops creation for review.
  confirmDuplicates?: boolean;
}

export type CreateRealtorResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string }
  | { ok: false; duplicates: DuplicateCandidate[] };

// Only a first and last name are required (§7 non-blocking data) —
// everything else is stored as NULL until someone actually knows it.
// Creating with a brokerage opens its history row in the same transaction
// (PR #1 review item 5), so the realtor never has a "current" brokerage
// with no history behind it.
export async function createRealtorQuick(input: NewRealtorInput): Promise<CreateRealtorResult> {
  const { userId } = await requireSession("crm:write");

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) return { ok: false, error: "First and last name are required." };
  const email = blankToNull(input.email);
  if (email && !z.email().safeParse(email).success) return { ok: false, error: "That email address doesn't look valid." };
  const rawPhone = input.phone?.trim() ?? "";
  if (!isValidPhoneInput(rawPhone)) return { ok: false, error: "Phone number must have 10 digits." };
  const phone = rawPhone ? digitsOnly(rawPhone) : null;
  const brokerageId = blankToNull(input.brokerageId);

  if (!input.confirmDuplicates) {
    const duplicates = await findRealtorDuplicates({ firstName, lastName, email, phone, brokerageId });
    if (duplicates.length > 0) return { ok: false, duplicates };
  }

  const realtor = await prisma.$transaction(async (tx) => {
    const created = await tx.realtor.create({
      data: { firstName, lastName, preferredName: blankToNull(input.preferredName), email, phone, brokerageId },
    });
    if (brokerageId) {
      await tx.realtorBrokerageHistory.create({ data: { realtorId: created.id, brokerageId, startDate: created.createdAt } });
    }
    await logActivity(tx, {
      actorId: userId,
      action: "realtor.created",
      entityType: "Realtor",
      entityId: created.id,
      after: { firstName, lastName, email, phone, brokerageId },
    });
    return created;
  });

  revalidatePath("/realtors");
  return { ok: true, data: { id: realtor.id } };
}

// Called directly from client code (not a <form action>) by a realtor
// Combobox's "+ Add new realtor" popup (e.g. while adding a realtor to a
// transaction) — see createBrokerageInline for the same pattern. Kept
// minimal (no brokerage picked here) so the popup stays quick; a brokerage
// can be set afterward from the realtor's own page.
export async function createRealtorInline(data: { firstName: string; lastName: string; phone: string }) {
  const { userId } = await requireSession("crm:write");

  const firstName = data.firstName.trim();
  const lastName = data.lastName.trim();
  if (!firstName || !lastName) throw new Error("First and last name are required.");
  if (!isValidPhoneInput(data.phone)) throw new Error("Phone number must have 10 digits.");
  const phone = data.phone ? digitsOnly(data.phone) : null;

  const realtor = await prisma.$transaction(async (tx) => {
    const created = await tx.realtor.create({ data: { firstName, lastName, phone } });
    await logActivity(tx, { actorId: userId, action: "realtor.created", entityType: "Realtor", entityId: created.id, after: { firstName, lastName, phone } });
    return created;
  });
  revalidatePath("/realtors");
  return { id: realtor.id, label: `${realtor.firstName} ${realtor.lastName}` };
}

// ---------------------------------------------------------------------------
// Inline profile edits
// ---------------------------------------------------------------------------

export interface RealtorProfilePatch {
  firstName?: string;
  lastName?: string;
  preferredName?: string | null;
  email?: string | null;
  phone?: string | null;
  preferredContactMethod?: string | null;
  notes?: string | null;
  active?: boolean;
}

const nullableText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((v) => blankToNull(v));

const profilePatchSchema = z
  .strictObject({
    firstName: z.string().trim().min(1, "First name can't be blank.").max(100),
    lastName: z.string().trim().min(1, "Last name can't be blank.").max(100),
    preferredName: nullableText(100),
    email: nullableText(254).refine((v) => v === null || z.email().safeParse(v).success, "That email address doesn't look valid."),
    phone: z
      .string()
      .nullable()
      .refine((v) => v === null || isValidPhoneInput(v), "Phone number must have 10 digits.")
      .transform((v) => (v && digitsOnly(v) ? digitsOnly(v) : null)),
    preferredContactMethod: z.enum(["PHONE", "TEXT", "EMAIL"]).nullable(),
    notes: nullableText(5000),
    active: z.boolean(),
  })
  .partial();

const CONTACT_FIELDS = ["firstName", "lastName", "preferredName", "email", "phone", "preferredContactMethod"] as const;

// One narrow, allow-listed patch action behind every inline field on the
// Realtor record and drawer — only the fields in profilePatchSchema can
// ever be written, and only what actually changed is audited.
export async function updateRealtorProfile(realtorId: string, patch: RealtorProfilePatch): Promise<ActionResult> {
  const { userId } = await requireSession("crm:write");

  const parsed = profilePatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid value." };
  const data = parsed.data;

  const current = await prisma.realtor.findUnique({ where: { id: realtorId } });
  if (!current || current.archivedAt) return { ok: false, error: "Realtor not found." };

  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((key) => data[key] !== current[key]);
  if (changed.length === 0) return { ok: true, data: undefined };

  const diff = (keys: readonly string[]) => {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of changed) {
      if (!keys.includes(key)) continue;
      before[key] = current[key];
      after[key] = data[key];
    }
    return Object.keys(after).length ? { before: before as Prisma.InputJsonObject, after: after as Prisma.InputJsonObject } : null;
  };

  await prisma.$transaction(async (tx) => {
    await tx.realtor.update({ where: { id: realtorId }, data: Object.fromEntries(changed.map((key) => [key, data[key]])) });
    const contact = diff(CONTACT_FIELDS);
    if (contact) await logActivity(tx, { actorId: userId, action: "realtor.contact_updated", entityType: "Realtor", entityId: realtorId, ...contact });
    const notes = diff(["notes"]);
    if (notes) await logActivity(tx, { actorId: userId, action: "realtor.notes_updated", entityType: "Realtor", entityId: realtorId, ...notes });
    const status = diff(["active"]);
    if (status) await logActivity(tx, { actorId: userId, action: "realtor.status_changed", entityType: "Realtor", entityId: realtorId, ...status });
  });

  revalidateRealtor(realtorId);
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Brokerage
// ---------------------------------------------------------------------------

// Moving a realtor to a new brokerage closes out the open history row rather
// than overwriting it, so a transaction from six months ago still shows the
// brokerage that was actually current at the time (§4, RealtorBrokerageHistory).
// "Moving" to the brokerage they're already at is a no-op, so it can't
// fragment their history into back-to-back rows for the same firm.
async function moveRealtorToBrokerage(realtorId: string, brokerageId: string, actorId: string | null) {
  const current = await prisma.realtor.findUniqueOrThrow({ where: { id: realtorId }, select: { brokerageId: true } });
  if (current.brokerageId === brokerageId) return;

  const startDate = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.realtorBrokerageHistory.updateMany({ where: { realtorId, endDate: null }, data: { endDate: startDate } });
    await tx.realtorBrokerageHistory.create({ data: { realtorId, brokerageId, startDate } });
    await tx.realtor.update({ where: { id: realtorId }, data: { brokerageId } });
    await logActivity(tx, {
      actorId,
      action: "realtor.brokerage_changed",
      entityType: "Realtor",
      entityId: realtorId,
      before: { brokerageId: current.brokerageId },
      after: { brokerageId },
    });
  });

  revalidateRealtor(realtorId);
}

export async function changeRealtorBrokerage(realtorId: string, formData: FormData) {
  const { userId } = await requireSession("crm:write");
  const brokerageId = String(formData.get("brokerageId") ?? "").trim();
  if (!brokerageId) throw new Error("A brokerage is required.");
  await moveRealtorToBrokerage(realtorId, brokerageId, userId);
}

export async function changeRealtorBrokerageInline(realtorId: string, brokerageId: string): Promise<ActionResult> {
  const { userId } = await requireSession("crm:write");
  if (!brokerageId) return { ok: false, error: "A brokerage is required." };
  await moveRealtorToBrokerage(realtorId, brokerageId, userId);
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Drawer + quick actions
// ---------------------------------------------------------------------------

export async function getRealtorPreview(realtorId: string): Promise<RealtorPreview | null> {
  const { role } = await requireSession();
  return loadRealtorPreview(realtorId, role);
}

// Realtor follow-ups are ordinary Tasks (with realtorId set), so they show
// up on /tasks alongside everything else. Assigned to whoever creates them.
export async function createRealtorTask(realtorId: string, input: { title: string; dueDate: string }): Promise<ActionResult> {
  const { userId } = await requireSession("crm:write");
  const title = input.title.trim();
  if (!title) return { ok: false, error: "A task title is required." };
  if (title.length > 200) return { ok: false, error: "Keep the title under 200 characters." };
  const dueAt = input.dueDate ? parseDateInput(input.dueDate) : null;
  if (input.dueDate && !dueAt) return { ok: false, error: "That due date isn't valid." };

  const realtor = await prisma.realtor.findUnique({ where: { id: realtorId }, select: { archivedAt: true } });
  if (!realtor || realtor.archivedAt) return { ok: false, error: "Realtor not found." };

  await prisma.task.create({ data: { title, dueAt, realtorId, assigneeId: userId } });
  revalidateRealtor(realtorId);
  revalidatePath("/tasks");
  return { ok: true, data: undefined };
}

// Append-only, like transaction communications — a logged call is a fact
// about what happened, never edited afterward.
export async function logRealtorCommunication(
  realtorId: string,
  input: { channel: string; direction: string; summary: string }
): Promise<ActionResult> {
  await requireSession("crm:write");
  const summary = input.summary.trim();
  if (!isCommunicationChannel(input.channel)) return { ok: false, error: "Pick a channel." };
  if (!isCommunicationDirection(input.direction)) return { ok: false, error: "Pick a direction." };
  if (!summary) return { ok: false, error: "Add a short summary." };

  await prisma.communication.create({ data: { realtorId, channel: input.channel, direction: input.direction, summary } });
  revalidateRealtor(realtorId);
  revalidatePath("/communications");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Referral attribution
// ---------------------------------------------------------------------------

// Referral attribution only ever flows through a ReferralSource linked to
// the Realtor. These two actions are how that link gets made — either a
// new "Realtor"-type source for them, or an existing unlinked one.
export async function createReferralSourceForRealtor(realtorId: string): Promise<ActionResult> {
  const { userId } = await requireSession("crm:write");
  const realtor = await prisma.realtor.findUnique({ where: { id: realtorId } });
  if (!realtor || realtor.archivedAt) return { ok: false, error: "Realtor not found." };
  const existing = await prisma.referralSource.findFirst({ where: { realtorId } });
  if (existing) return { ok: false, error: `Already linked to referral source "${existing.name}".` };

  await prisma.$transaction(async (tx) => {
    const source = await tx.referralSource.create({
      data: { name: `${realtor.firstName} ${realtor.lastName}`, type: "Realtor", realtorId },
    });
    await logActivity(tx, { actorId: userId, action: "realtor.referral_source_linked", entityType: "Realtor", entityId: realtorId, after: { referralSourceId: source.id } });
  });
  revalidateRealtor(realtorId);
  revalidatePath("/referral-sources");
  return { ok: true, data: undefined };
}

export async function linkReferralSourceToRealtor(realtorId: string, referralSourceId: string): Promise<ActionResult> {
  const { userId } = await requireSession("crm:write");
  const source = await prisma.referralSource.findUnique({ where: { id: referralSourceId } });
  if (!source) return { ok: false, error: "Referral source not found." };
  // Re-pointing a source that already belongs to another realtor would
  // silently move that realtor's referral history — refuse instead.
  if (source.realtorId && source.realtorId !== realtorId) {
    return { ok: false, error: "That referral source is already linked to a different realtor." };
  }
  if (source.realtorId === realtorId) return { ok: true, data: undefined };

  await prisma.$transaction(async (tx) => {
    await tx.referralSource.update({ where: { id: referralSourceId }, data: { realtorId } });
    await logActivity(tx, { actorId: userId, action: "realtor.referral_source_linked", entityType: "Realtor", entityId: realtorId, after: { referralSourceId } });
  });
  revalidateRealtor(realtorId);
  revalidatePath("/referral-sources");
  return { ok: true, data: undefined };
}
