"use server";

import type { Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import * as users from "@/lib/users";

async function requireManager() {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "user:manage");
  return session!.user.id;
}

const done = <T,>(r: users.Result<T>) => {
  if (r.ok) revalidatePath("/settings/users");
  return r;
};

export async function createUserAction(input: { name: string; email: string; role: string }) {
  return done(await users.createUser(await requireManager(), input));
}

export async function changeRoleAction(userId: string, role: string) {
  return done(await users.changeRole(await requireManager(), userId, role));
}

export async function setActiveAction(userId: string, active: boolean) {
  return done(await users.setActive(await requireManager(), userId, active));
}

export async function resetPasswordAction(userId: string) {
  return done(await users.resetPassword(await requireManager(), userId));
}
