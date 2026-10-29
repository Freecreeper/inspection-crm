"use server";

import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth, updateSession } from "@/lib/auth";
import { THEME_COOKIE, encodeTheme, uiPreferencesWithTheme, validTheme, type ThemePreference } from "@/lib/theme";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

// Saves the signed-in user's own theme (the user id comes from the session,
// never the request). The input is validated the same way a stored one is
// read back: anything unknown falls back to the default, so a bad request
// can't store an unusable theme. Returns what was saved.
export async function saveThemePreference(input: unknown): Promise<ThemePreference> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not signed in.");
  const theme = { ...validTheme(input), savedAt: Date.now() };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { uiPreferences: true } });
  await prisma.user.update({ where: { id: userId }, data: { uiPreferences: uiPreferencesWithTheme(user?.uiPreferences, theme) as Prisma.InputJsonValue } });

  // Same theme for this browser's signed-out pages, and a fresh session
  // token so the next page renders it without waiting for the periodic check.
  (await cookies()).set(THEME_COOKIE, encodeTheme(theme), { path: "/", maxAge: ONE_YEAR_SECONDS, sameSite: "lax" });
  await updateSession({});
  return theme;
}
