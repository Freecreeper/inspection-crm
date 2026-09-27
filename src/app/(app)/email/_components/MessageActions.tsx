"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EmailStatus } from "@prisma/client";
import { cancelEmail, processEmailQueueNow, retryEmail } from "../actions";

const btn = "rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

export function MessageActions({ id, status, canSend }: { id: string; status: EmailStatus; canSend: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!canSend) return null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await fn();
        if (!result.ok) setError(result.error ?? "Couldn't do that.");
        router.refresh();
      } catch {
        setError("You may not have permission to do that.");
      }
    });

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="flex gap-1.5">
        {(status === "FAILED" || status === "SKIPPED") && (
          <button type="button" disabled={pending} onClick={() => run(() => retryEmail(id))} className={btn}>
            Retry
          </button>
        )}
        {(status === "QUEUED" || status === "SCHEDULED") && (
          <button type="button" disabled={pending} onClick={() => run(() => cancelEmail(id))} className={btn}>
            Cancel
          </button>
        )}
      </span>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}

export function ProcessQueueButton() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              const result = await processEmailQueueNow();
              setMessage(result.ok ? `Processed: ${result.data.sent} sent, ${result.data.failed} failed, ${result.data.other} other.` : result.error);
              router.refresh();
            } catch {
              setMessage("You may not have permission to run the queue.");
            }
          })
        }
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Processing…" : "Process queue now"}
      </button>
      {message && (
        <span role="status" className="text-xs text-slate-600">
          {message}
        </span>
      )}
    </span>
  );
}
