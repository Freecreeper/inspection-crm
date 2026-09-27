"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { PhoneField } from "@/components/PhoneField";
import { formatPhone, isValidPhoneInput } from "@/lib/phone";
import { createBrokerageQuick, type BrokerageDuplicate, type NewBrokerageInput } from "../actions";

const input = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const optional = <span className="font-normal text-slate-400">(optional)</span>;

const EMPTY: Omit<NewBrokerageInput, "confirmDuplicates"> = { name: "", phone: "", email: "", addressLine1: "", city: "", state: "", zip: "" };

export function AddBrokerageButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
      >
        + Add Brokerage
      </button>
      {open && <AddBrokerageModal onClose={() => setOpen(false)} />}
    </>
  );
}

// Only the name is required. Likely duplicates are shown for a person to
// judge, the same way Add Realtor does — "Create anyway" is always there.
function AddBrokerageModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [fields, setFields] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<BrokerageDuplicate[] | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [key]: e.target.value });

  function submit(confirmDuplicates: boolean) {
    setError(null);
    if (!fields.name.trim()) return setError("Brokerage name is required.");
    if (!isValidPhoneInput(fields.phone)) return setError("Phone number must have 10 digits.");
    startTransition(async () => {
      try {
        const result = await createBrokerageQuick({ ...fields, confirmDuplicates });
        if (result.ok) {
          onClose();
          router.push(`/brokerages/${result.data.id}`);
        } else if ("duplicates" in result) {
          setDuplicates(result.duplicates);
        } else {
          setError(result.error);
        }
      } catch {
        setError("Couldn't create the brokerage. You may not have permission.");
      }
    });
  }

  return (
    <Modal open onClose={onClose} title={duplicates ? "Possible existing brokerage" : "Add brokerage"} titleId={`${id}-title`}>
      {duplicates ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            These existing brokerages look similar to <span className="font-medium text-slate-900">{fields.name.trim()}</span>. Open one if it&apos;s
            the same office, or create a new record anyway.
          </p>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {duplicates.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-slate-900">{d.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {[d.phone ? formatPhone(d.phone) : null, [d.city, d.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "No other details"}
                  </p>
                  <p className="mt-1 text-xs font-medium text-amber-700">{d.reason === "name" ? "Same name" : "Same phone"}</p>
                </div>
                <Link href={`/brokerages/${d.id}`} className="shrink-0 text-sm font-medium text-emerald-700 hover:underline">
                  Open
                </Link>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDuplicates(null)} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Back
            </button>
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={pending}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {pending ? "Creating…" : "Create anyway"}
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
          <div>
            <label htmlFor={`${id}-name`} className="block text-sm font-medium text-slate-700">
              Brokerage name
            </label>
            <input id={`${id}-name`} value={fields.name} onChange={set("name")} required className={input} />
          </div>
          <PhoneField value={fields.phone} onChange={(phone) => setFields({ ...fields, phone })} />
          <div>
            <label htmlFor={`${id}-email`} className="block text-sm font-medium text-slate-700">
              Email {optional}
            </label>
            <input id={`${id}-email`} type="email" value={fields.email} onChange={set("email")} className={input} />
          </div>
          <div>
            <label htmlFor={`${id}-street`} className="block text-sm font-medium text-slate-700">
              Street address {optional}
            </label>
            <input id={`${id}-street`} value={fields.addressLine1} onChange={set("addressLine1")} autoComplete="street-address" className={input} />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_5rem_6rem] gap-3">
            <div>
              <label htmlFor={`${id}-city`} className="block text-sm font-medium text-slate-700">
                City
              </label>
              <input id={`${id}-city`} value={fields.city} onChange={set("city")} className={input} />
            </div>
            <div>
              <label htmlFor={`${id}-state`} className="block text-sm font-medium text-slate-700">
                State
              </label>
              <input id={`${id}-state`} value={fields.state} onChange={set("state")} maxLength={2} placeholder="NC" className={`${input} uppercase`} />
            </div>
            <div>
              <label htmlFor={`${id}-zip`} className="block text-sm font-medium text-slate-700">
                ZIP
              </label>
              <input id={`${id}-zip`} value={fields.zip} onChange={set("zip")} inputMode="numeric" maxLength={10} className={input} />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
              {pending ? "Checking…" : "Add brokerage"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
