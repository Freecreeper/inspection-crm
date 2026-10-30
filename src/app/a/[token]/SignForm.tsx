"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signAgreementAction } from "./actions";

export function SignForm({ token, expectedName, expiresOn }: { token: string; expectedName: string; expiresOn: string }) {
  const router = useRouter();
  const id = useId();
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      aria-labelledby={`${id}-heading`}
      className="rounded-lg border border-border bg-surface p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          try {
            const result = await signAgreementAction(token, { name, agreed });
            if (!result.ok) return setError(result.error);
            router.refresh();
          } catch {
            setError("Something went wrong. Please try again.");
          }
        });
      }}
    >
      <h2 id={`${id}-heading`} className="text-base font-semibold text-foreground">
        Sign the agreement
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Prepared for {expectedName}. This link works until {expiresOn}.
      </p>
      <label className="mt-4 flex items-start gap-2 text-sm text-neutral-800">
        <input type="checkbox" checked={agreed} disabled={pending} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4" />
        <span>I have read this agreement, agree to its terms, and agree to sign it electronically.</span>
      </label>
      <label htmlFor={`${id}-name`} className="mt-4 block text-sm font-medium text-neutral-800">
        Type your full name
        <input
          id={`${id}-name`}
          value={name}
          maxLength={120}
          autoComplete="name"
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full rounded-md border border-input px-3 py-2 font-serif text-lg italic focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-strong">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending || !agreed || name.trim().length < 2} className="mt-4 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60 sm:w-auto">
        {pending ? "Signing…" : "Sign agreement"}
      </button>
    </form>
  );
}
