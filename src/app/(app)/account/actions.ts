"use server";

import { auth, signOut } from "@/lib/auth";
import { changeOwnPassword, type Result } from "@/lib/users";

export type PasswordFormState = { error: string | null };

export async function changePasswordAction(_prev: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: "You're signed out. Sign in again." };
  const result: Result = await changeOwnPassword(userId, {
    current: String(formData.get("current") ?? ""),
    next: String(formData.get("next") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!result.ok) return { error: result.error };
  // Every session (this one too) was revoked; sign in with the new password.
  await signOut({ redirectTo: "/login?notice=changed" });
  return { error: null };
}
