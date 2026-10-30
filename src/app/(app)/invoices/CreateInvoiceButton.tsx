"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoice } from "./actions";

// Creates a draft (or opens the inspection's existing invoice) and goes to it.
export function CreateInvoiceButton({
  transactionId,
  inspectionId,
  label = "Create invoice",
  className = "rounded-md border border-input bg-surface px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-hover disabled:opacity-60",
}: {
  transactionId: string;
  inspectionId?: string | null;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className={className}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await createInvoice({ transactionId, inspectionId });
              if (!result.ok) return setError(result.error);
              router.push(`/invoices/${result.data.id}`);
            } catch {
              setError("You may not have permission to create invoices.");
            }
          });
        }}
      >
        {pending ? "Creating…" : label}
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger-strong">
          {error}
        </span>
      )}
    </span>
  );
}
