"use server";

import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan, type Permission } from "@/lib/rbac";
import { defaultPreferences, validatePreferences, type DashboardPreferences } from "@/lib/dashboard/preferences";
import { globalSearch } from "@/lib/search/global";
import type { GlobalSearchResult } from "@/lib/search/kinds";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function requireUser(permission: Permission) {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  assertCan(role, permission);
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not signed in.");
  return { role: role!, userId };
}

// Saves the signed-in user's Dashboard layout — only theirs (the user id
// comes from the session, never the request). Validation is strict: an
// unknown or unauthorized widget/KPI, a duplicate, or more than the KPI
// limit is refused and nothing is written.
export async function saveDashboardPreferences(input: unknown): Promise<Result<DashboardPreferences>> {
  const { role, userId } = await requireUser("dashboard:view");
  const checked = validatePreferences(input, role);
  if (!checked.ok) return checked;
  await prisma.user.update({ where: { id: userId }, data: { dashboardPreferences: checked.value as unknown as Prisma.InputJsonValue } });
  return { ok: true, data: checked.value };
}

// Clears the stored layout, so the role default (filtered by the user's
// current permissions) applies again — including future default changes.
export async function restoreDashboardDefaults(): Promise<Result<DashboardPreferences>> {
  const { role, userId } = await requireUser("dashboard:view");
  await prisma.user.update({ where: { id: userId }, data: { dashboardPreferences: Prisma.DbNull } });
  return { ok: true, data: defaultPreferences(role) };
}

export async function searchEverything(query: string): Promise<GlobalSearchResult[]> {
  const { role } = await requireUser("search:global");
  if (typeof query !== "string") return [];
  return globalSearch(query, role);
}
