"use server";

import { revalidatePath } from "next/cache";
import { applyResubscribe, applyUnsubscribe } from "@/lib/email/preferences";
import { verifyUnsubscribeToken, type UnsubscribeScope } from "@/lib/email/unsubscribe";

// Public (token-authenticated) preference changes. The signed token is the
// only authority: it names one realtor, and the scope is limited to the
// two non-operational categories.
export async function setEmailPreference(token: string, scope: UnsubscribeScope, subscribed: boolean) {
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return { ok: false as const };
  if (subscribed) await applyResubscribe(verified.realtorId, scope, "recipient preference page");
  else await applyUnsubscribe(verified.realtorId, scope, "recipient preference page");
  revalidatePath(`/u/${token}`);
  return { ok: true as const };
}
