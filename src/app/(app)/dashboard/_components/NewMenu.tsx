"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal } from "@/components/Modal";
import { PhoneField } from "@/components/PhoneField";
import { Popover } from "@/components/Popover";
import type { CustomerDuplicate } from "@/lib/scheduling/records";
import { createCustomerQuick } from "../../calendar/actions";

export type NewAction = "schedule" | "customer" | "task";

const itemClass = "block w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none";

// "+ New": the common starting points, each shown only to roles that may
// do it (the server actions enforce the same permissions). Dialogs reuse
// the Calendar's scheduling and task dialogs; the rest open existing pages.
export function NewMenu({
  canSchedule,
  canWriteCrm,
  canAddTask,
  onAction,
}: {
  canSchedule: boolean;
  canWriteCrm: boolean;
  canAddTask: boolean;
  onAction: (action: NewAction) => void;
}) {
  const items: ({ label: string; action: NewAction } | { label: string; href: string })[] = [];
  if (canSchedule) items.push({ label: "Schedule inspection", action: "schedule" });
  if (canWriteCrm) {
    items.push({ label: "New customer", action: "customer" });
    items.push({ label: "New realtor", href: "/realtors/new" });
    items.push({ label: "New transaction", href: "/transactions/new" });
    items.push({ label: "New lead", href: "/leads" });
  }
  if (canAddTask) items.push({ label: "New task", action: "task" });
  if (items.length === 0) return null;

  return (
    <Popover
      label={
        <>
          <Plus className="h-4 w-4" aria-hidden="true" /> New
        </>
      }
      buttonClassName="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
    >
      {(close) => (
        <div
          role="menu"
          aria-label="Create new"
          className="flex flex-col"
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const nodes = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
            const i = nodes.indexOf(document.activeElement as HTMLElement);
            nodes[(i + (e.key === "ArrowDown" ? 1 : nodes.length - 1)) % nodes.length]?.focus();
          }}
        >
          {items.map((item) =>
            "href" in item ? (
              <Link key={item.label} href={item.href} role="menuitem" className={itemClass} onClick={() => close()}>
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={itemClass}
                onClick={() => {
                  close();
                  onAction(item.action);
                }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </Popover>
  );
}

const input = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";

// A customer needs only a name. Likely duplicates are shown first — the
// same check scheduling uses — and nothing is merged automatically.
export function NewCustomerDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<CustomerDuplicate[] | null>(null);
  const [pending, start] = useTransition();

  const submit = (confirmDuplicates: boolean) =>
    start(async () => {
      setError(null);
      try {
        const result = await createCustomerQuick({ ...form, confirmDuplicates, source: "dashboard" });
        if (result.ok) {
          onClose();
          router.push(`/customers/${result.data.id}`);
        } else if ("duplicates" in result) {
          setDuplicates(result.duplicates);
        } else {
          setError(result.error);
        }
      } catch {
        setError("You may not have permission to add customers.");
      }
    });

  return (
    <Modal open onClose={onClose} title="New customer" titleId="new-customer-title">
      {duplicates ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">These customers look similar. Open one, or create a new customer anyway.</p>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {duplicates.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 text-sm">
                  <span className="block font-medium text-slate-900">{d.name}</span>
                  <span className="block text-xs text-slate-500">
                    Same {d.reasons.join(", ")}
                    {d.email ? ` · ${d.email}` : ""}
                  </span>
                </span>
                <Link href={`/customers/${d.id}`} onClick={onClose} className="rounded-md border border-slate-300 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Open
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex justify-between gap-2">
            <button type="button" onClick={() => setDuplicates(null)} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              Back
            </button>
            <button type="button" disabled={pending} onClick={() => submit(true)} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
              Create anyway
            </button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-slate-700">
              First name
              <input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={input} />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Last name
              <input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={input} />
            </label>
          </div>
          <label className="block text-sm font-medium text-slate-700">
            Email (optional)
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
          </label>
          <PhoneField value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
          {error && (
            <p role="alert" className="text-sm text-rose-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
              {pending ? "Saving…" : "Create customer"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
