"use client";

import { useActionState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/security/passwordRules";
import { resetPasswordAction, type ResetFormState } from "./actions";

const input = "mt-1 block w-full rounded-md border border-input px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetFormState, FormData>(resetPasswordAction.bind(null, token), { error: null });
  return (
    <form action={action} className="mt-6 space-y-4">
      {state.error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
          {state.error}
        </p>
      )}
      <label className="block text-sm font-medium text-neutral-700">
        New password
        <input name="next" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} aria-describedby="reset-rules" className={input} />
      </label>
      <p id="reset-rules" className="text-xs text-muted-foreground">
        At least {MIN_PASSWORD_LENGTH} characters. A few unrelated words is easiest to remember.
      </p>
      <label className="block text-sm font-medium text-neutral-700">
        Confirm new password
        <input name="confirm" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} className={input} />
      </label>
      <button type="submit" disabled={pending} className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60">
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
