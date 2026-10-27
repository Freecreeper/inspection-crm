"use server";

import { redirect } from "next/navigation";
import { resetPasswordWithToken } from "@/lib/security/passwordReset";

export type ResetFormState = { error: string | null };

export async function resetPasswordAction(token: string, _prev: ResetFormState, formData: FormData): Promise<ResetFormState> {
  const result = await resetPasswordWithToken(token, { next: String(formData.get("next") ?? ""), confirm: String(formData.get("confirm") ?? "") });
  if (!result.ok) return { error: result.error };
  redirect("/login?notice=reset");
}
