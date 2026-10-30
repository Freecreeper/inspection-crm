"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addInvoiceItem, deleteDraftInvoice, issueInvoice, removeInvoiceItem, setInvoiceDueDate, updateInvoiceItem, voidInvoice } from "./actions";

type Line = { id: string; description: string; amount: string; display: string };
type Result = { ok: true } | { ok: false; error: string };

const input = "rounded-md border border-input px-2 py-1 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:bg-surface-secondary";
const secondaryButton = "rounded-md border border-input bg-surface px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-hover disabled:opacity-60";

// Lines, due date and the draft → issued → void moves. Totals and status
// come from the server (router.refresh after every save), never computed here.
export function InvoiceEditor({
  invoiceId,
  transactionId,
  status,
  lines,
  totals,
  dueDay,
  services,
  canEdit,
  canVoid,
}: {
  invoiceId: string;
  transactionId: string;
  status: string;
  lines: Line[];
  totals: { total: string; paid: string; balance: string };
  dueDay: string;
  services: { name: string; price: string }[];
  canEdit: boolean;
  canVoid: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const draft = status === "DRAFT";
  const editable = draft && canEdit;
  const dueEditable = canEdit && status !== "VOID" && status !== "PAID";

  const run = (fn: () => Promise<Result>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) return setError(result.error);
        after?.();
        router.refresh();
      } catch {
        setError("Something went wrong, or you may not have permission to change invoices.");
      }
    });
  };

  return (
    <div className="space-y-4">
      <section aria-label="Invoice lines" className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              {editable && <th className="w-10 px-2 py-2" aria-label="Remove" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) =>
              editable ? (
                <EditableLine key={line.id} line={line} disabled={pending} onSave={(d, a) => run(() => updateInvoiceItem(line.id, { description: d, amount: a }))} onRemove={() => run(() => removeInvoiceItem(line.id))} />
              ) : (
                <tr key={line.id} className="border-t border-neutral-100">
                  <td className="px-4 py-2 text-neutral-800">{line.description}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-800">{line.display}</td>
                </tr>
              )
            )}
            {lines.length === 0 && (
              <tr>
                <td colSpan={editable ? 3 : 2} className="px-4 py-6 text-center text-muted-foreground">
                  No lines yet.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t border-border text-sm">
            <tr>
              <td className="px-4 pt-3 text-right text-neutral-600">Total</td>
              <td className="px-4 pt-3 text-right font-semibold tabular-nums text-foreground">{totals.total}</td>
              {editable && <td />}
            </tr>
            {!draft && (
              <>
                <tr>
                  <td className="px-4 pt-1 text-right text-neutral-600">Paid</td>
                  <td className="px-4 pt-1 text-right tabular-nums text-neutral-700">{totals.paid}</td>
                </tr>
                <tr>
                  <td className="px-4 pb-3 pt-1 text-right font-medium text-neutral-700">Balance due</td>
                  <td className="px-4 pb-3 pt-1 text-right font-semibold tabular-nums text-foreground">{totals.balance}</td>
                </tr>
              </>
            )}
            {draft && (
              <tr>
                <td className="pb-3" colSpan={editable ? 3 : 2} />
              </tr>
            )}
          </tfoot>
        </table>
      </section>

      {editable && <AddLine services={services} disabled={pending} onAdd={(d, a, done) => run(() => addInvoiceItem(invoiceId, { description: d, amount: a }), done)} />}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label htmlFor={`${id}-due`} className="text-sm text-neutral-700">
          Due date
          <span className="mt-1 flex items-center gap-2">
            <input
              id={`${id}-due`}
              type="date"
              defaultValue={dueDay}
              disabled={!dueEditable || pending}
              onChange={(e) => run(() => setInvoiceDueDate(invoiceId, e.target.value))}
              className={input}
            />
            {!dueDay && <span className="text-xs text-muted-foreground">Due upon receipt</span>}
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          {editable && (
            <>
              <button
                type="button"
                disabled={pending}
                className={secondaryButton}
                onClick={() => {
                  if (!window.confirm("Delete this draft invoice? It was never sent, so nothing else changes.")) return;
                  run(
                    () => deleteDraftInvoice(invoiceId),
                    () => router.push(`/transactions/${transactionId}`)
                  );
                }}
              >
                Delete draft
              </button>
              <button
                type="button"
                disabled={pending || lines.length === 0}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
                onClick={() => {
                  if (!window.confirm("Issue this invoice? Its lines can't be changed afterward. You can email it next.")) return;
                  run(() => issueInvoice(invoiceId));
                }}
              >
                Issue invoice
              </button>
            </>
          )}
          {canVoid && (status === "SENT" || status === "OVERDUE") && (
            <button
              type="button"
              disabled={pending}
              className={secondaryButton}
              onClick={() => {
                if (!window.confirm("Void this invoice? It will no longer be owed, and any reminder that hasn't gone out is withdrawn.")) return;
                run(() => voidInvoice(invoiceId));
              }}
            >
              Void invoice
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
          {error}
        </p>
      )}
    </div>
  );
}

function EditableLine({ line, disabled, onSave, onRemove }: { line: Line; disabled: boolean; onSave: (description: string, amount: string) => void; onRemove: () => void }) {
  const [description, setDescription] = useState(line.description);
  const [amount, setAmount] = useState(line.amount);
  const save = () => {
    if (description.trim() !== line.description || amount.trim() !== line.amount) onSave(description, amount);
  };
  return (
    <tr className="border-t border-neutral-100">
      <td className="px-4 py-1.5">
        <input aria-label="Description" value={description} maxLength={200} disabled={disabled} onChange={(e) => setDescription(e.target.value)} onBlur={save} className={`${input} w-full`} />
      </td>
      <td className="px-4 py-1.5 text-right">
        <input aria-label="Amount" inputMode="decimal" value={amount} disabled={disabled} onChange={(e) => setAmount(e.target.value)} onBlur={save} className={`${input} w-28 text-right tabular-nums`} />
      </td>
      <td className="px-2 py-1.5 text-center">
        <button type="button" disabled={disabled} onClick={onRemove} aria-label={`Remove ${line.description}`} className="rounded px-1.5 text-lg leading-none text-neutral-500 hover:bg-hover hover:text-foreground disabled:opacity-60">
          ×
        </button>
      </td>
    </tr>
  );
}

function AddLine({ services, disabled, onAdd }: { services: { name: string; price: string }[]; disabled: boolean; onAdd: (description: string, amount: string, done: () => void) => void }) {
  const id = useId();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const reset = () => {
    setDescription("");
    setAmount("");
  };
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-input p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(description, amount, reset);
      }}
    >
      {services.length > 0 && (
        <label htmlFor={`${id}-svc`} className="text-xs text-neutral-600">
          Add a service
          <select
            id={`${id}-svc`}
            value=""
            disabled={disabled}
            onChange={(e) => {
              const s = services.find((x) => x.name === e.target.value);
              if (s) onAdd(s.name, s.price, reset);
            }}
            className={`${input} mt-1 block`}
          >
            <option value="">Choose…</option>
            {services.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} (${s.price})
              </option>
            ))}
          </select>
        </label>
      )}
      <label htmlFor={`${id}-desc`} className="min-w-48 flex-1 text-xs text-neutral-600">
        Or a custom line
        <input id={`${id}-desc`} value={description} maxLength={200} disabled={disabled} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Trip charge, or Discount" className={`${input} mt-1 block w-full`} />
      </label>
      <label htmlFor={`${id}-amt`} className="text-xs text-neutral-600">
        Amount
        <input id={`${id}-amt`} inputMode="decimal" value={amount} disabled={disabled} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${input} mt-1 block w-28 text-right tabular-nums`} />
      </label>
      <button type="submit" disabled={disabled || !description.trim() || !amount.trim()} className={secondaryButton}>
        Add line
      </button>
    </form>
  );
}
