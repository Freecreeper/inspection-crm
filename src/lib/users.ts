import type { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { ROLES } from "./userRoles";
import { hashPassword, passwordProblem, temporaryPassword, verifyPassword } from "@/lib/security/password";

// Staff account management. Every change is audited. Two invariants keep
// the business from locking itself out: nobody can deactivate or demote
// themselves, and the last active owner can't be removed. Temporary
// passwords are returned once to the caller (shown once in the UI) and
// stored only as a hash; the user must replace them at next sign-in.

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export { ROLE_LABELS, ROLES } from "./userRoles";

const NewUser = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  email: z.email("Enter a valid email address.").transform((e) => e.trim().toLowerCase()),
  role: z.enum(ROLES as [Role, ...Role[]], "Pick a role."),
});

async function otherActiveOwners(excludingId: string): Promise<number> {
  return prisma.user.count({ where: { role: "OWNER_ADMIN", active: true, id: { not: excludingId } } });
}

export async function createUser(actorId: string, input: unknown): Promise<Result<{ id: string; email: string; temporaryPassword: string }>> {
  const parsed = NewUser.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
  const { name, email, role } = parsed.data;
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return { ok: false, error: "Someone already uses that email address." };
  const password = temporaryPassword();
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { name, email, role, passwordHash: await hashPassword(password), mustChangePassword: true } });
    await logActivity(tx, { actorId, action: "user.created", entityType: "User", entityId: created.id, after: { name, email, role } });
    return created;
  });
  return { ok: true, data: { id: user.id, email, temporaryPassword: password } };
}

export async function changeRole(actorId: string, userId: string, role: unknown): Promise<Result> {
  if (typeof role !== "string" || !ROLES.includes(role as Role)) return { ok: false, error: "Pick a role." };
  if (userId === actorId) return { ok: false, error: "You can't change your own role." };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, active: true } });
  if (!user) return { ok: false, error: "User not found." };
  if (user.role === role) return { ok: true, data: undefined };
  if (user.role === "OWNER_ADMIN" && user.active && (await otherActiveOwners(userId)) === 0) return { ok: false, error: "This is the only active owner. Make someone else an owner first." };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { role: role as Role } });
    await logActivity(tx, { actorId, action: "user.role_changed", entityType: "User", entityId: userId, before: { role: user.role }, after: { role } });
  });
  return { ok: true, data: undefined };
}

export async function setActive(actorId: string, userId: string, active: boolean): Promise<Result> {
  if (userId === actorId) return { ok: false, error: "You can't deactivate yourself." };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, active: true } });
  if (!user) return { ok: false, error: "User not found." };
  if (user.active === active) return { ok: true, data: undefined };
  if (!active && user.role === "OWNER_ADMIN" && (await otherActiveOwners(userId)) === 0) return { ok: false, error: "This is the only active owner. Make someone else an owner first." };
  await prisma.$transaction(async (tx) => {
    // Deactivating also revokes every session at once.
    await tx.user.update({ where: { id: userId }, data: { active, ...(active ? {} : { sessionVersion: { increment: 1 } }) } });
    await logActivity(tx, { actorId, action: active ? "user.reactivated" : "user.deactivated", entityType: "User", entityId: userId });
  });
  return { ok: true, data: undefined };
}

export async function resetPassword(actorId: string, userId: string): Promise<Result<{ temporaryPassword: string }>> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { ok: false, error: "User not found." };
  const password = temporaryPassword();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password), mustChangePassword: true, sessionVersion: { increment: 1 } } });
    await logActivity(tx, { actorId, action: "user.password_reset", entityType: "User", entityId: userId });
  });
  return { ok: true, data: { temporaryPassword: password } };
}

// The signed-in user's own password. Signs every session out (including
// this one), so they sign in again with the new password.
export async function changeOwnPassword(userId: string, input: { current: string; next: string; confirm: string }): Promise<Result> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, passwordHash: true, active: true } });
  if (!user || !user.active) return { ok: false, error: "Your account isn't active." };
  if (!(await verifyPassword(input.current ?? "", user.passwordHash))) return { ok: false, error: "Your current password is incorrect." };
  if (input.next !== input.confirm) return { ok: false, error: "The new passwords don't match." };
  const problem = passwordProblem(input.next ?? "", { email: user.email, current: input.current });
  if (problem) return { ok: false, error: problem };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.next), mustChangePassword: false, sessionVersion: { increment: 1 } } });
    await logActivity(tx, { actorId: userId, action: "user.password_changed", entityType: "User", entityId: userId });
  });
  return { ok: true, data: undefined };
}
