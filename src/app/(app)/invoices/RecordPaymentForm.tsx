"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPayment } from "./actions";

export function RecordPaymentForm({ invoiceId, balance }: { invoiceId: string; balance: string }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState("CARD");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-input bg-surface px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-hover">
        Record payment
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          try {
            const result = await recordPayment(invoiceId, { amount, method, reference });
            if (!result.ok) return setError(result.error);
            setOpen(false);
            router.refresh();
          } catch {
            setError("You may not have permission to record payments.");
          }
        });
      }}
    >
      <label htmlFor={`${id}-amt`} className="text-xs text-neutral-600">
        Amount
        <input id={`${id}-amt`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 block w-24 rounded-md border border-input px-2 py-1 text-sm" />
      </label>
      <label htmlFor={`${id}-method`} className="text-xs text-neutral-600">
        Method
        <select id={`${id}-method`} value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 block rounded-md border border-input px-2 py-1 text-sm">
          <option value="CARD">Card</option>
          <option value="ACH">ACH</option>
          <option value="CHECK">Check</option>
          <option value="CASH">Cash</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <label htmlFor={`${id}-ref`} className="text-xs text-neutral-600">
        Reference
        <input id={`${id}-ref`} value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 block w-28 rounded-md border border-input px-2 py-1 text-sm" />
      </label>
      <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="px-1 text-xs text-muted-foreground hover:underline">
        Cancel
      </button>
      {error && (
        <p role="alert" className="w-full text-xs text-danger-strong">
          {error}
        </p>
      )}
    </form>
  );
}
