"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { PhoneField } from "@/components/PhoneField";
import { formatPhone, isValidPhoneInput } from "@/lib/phone";
import type { DuplicateCandidate, DuplicateReason } from "@/lib/realtors/duplicates";
import { BrokerageCombobox } from "../BrokerageCombobox";
import { createRealtorQuick } from "../actions";

const REASON_LABELS: Record<DuplicateReason, string> = {
  email: "Same email",
  phone: "Same phone",
  nameBrokerage: "Same name and brokerage",
};

const input = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

// Only first and last name are required. Possible duplicates are shown
// for a person to judge — nothing is ever merged automatically; "Create
// anyway" is always available.
export function AddRealtorButton({ brokerages, defaultOpen = false }: { brokerages: { id: string; name: string }[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
      >
        + Add Realtor
      </button>
      {open && <AddRealtorModal brokerages={brokerages} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddRealtorModal({ brokerages, onClose }: { brokerages: { id: string; name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [brokerageId, setBrokerageId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  function submit(confirmDuplicates: boolean) {
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError("First and last name are required.");
      return;
    }
    if (!isValidPhoneInput(phone)) {
      setError("Phone number must have 10 digits.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await createRealtorQuick({ firstName, lastName, preferredName, email, phone, brokerageId, confirmDuplicates });
        if (result.ok) {
          onClose();
          router.push(`/realtors?selected=${result.data.id}`);
          router.refresh();
        } else if ("duplicates" in result) {
          setDuplicates(result.duplicates);
        } else {
          setError(result.error);
        }
      } catch {
        setError("Couldn't create the realtor. You may not have permission.");
      }
    });
  }

  return (
    <Modal open onClose={onClose} title={duplicates ? "Possible existing realtor" : "Add realtor"} titleId={`${id}-title`}>
      {duplicates ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            These existing records look similar to <span className="font-medium text-slate-900">{firstName} {lastName}</span>. Open one if
            it&apos;s the same person, or create a new record anyway.
          </p>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {duplicates.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-slate-900">{d.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {[d.brokerageName, d.email, d.phone ? formatPhone(d.phone) : null].filter(Boolean).join(" · ") || "No other details"}
                  </p>
                  <p className={`mt-1 text-xs font-medium ${d.exact ? "text-amber-700" : "text-slate-600"}`}>
                    {d.exact ? "Likely match" : "Possible match"}: {d.reasons.map((r) => REASON_LABELS[r]).join(", ")}
                  </p>
                </div>
                <Link href={`/realtors/${d.id}`} className="shrink-0 text-sm font-medium text-emerald-700 hover:underline">
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${id}-first`} className="block text-sm font-medium text-slate-700">
                First name
              </label>
              <input id={`${id}-first`} value={firstName} onChange={(e) => setFirstName(e.target.value)} required className={input} />
            </div>
            <div>
              <label htmlFor={`${id}-last`} className="block text-sm font-medium text-slate-700">
                Last name
              </label>
              <input id={`${id}-last`} value={lastName} onChange={(e) => setLastName(e.target.value)} required className={input} />
            </div>
          </div>
          <div>
            <label htmlFor={`${id}-preferred`} className="block text-sm font-medium text-slate-700">
              Preferred name <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input id={`${id}-preferred`} value={preferredName} onChange={(e) => setPreferredName(e.target.value)} className={input} />
          </div>
          <PhoneField value={phone} onChange={setPhone} />
          <div>
            <label htmlFor={`${id}-email`} className="block text-sm font-medium text-slate-700">
              Email <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
          </div>
          <div>
            <span className="block text-sm font-medium text-slate-700">
              Brokerage <span className="font-normal text-slate-400">(optional)</span>
            </span>
            <div className="mt-1">
              <BrokerageCombobox name="brokerageId" options={brokerages.map((b) => ({ id: b.id, label: b.name }))} onSelect={(o) => setBrokerageId(o?.id ?? "")} />
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
              {pending ? "Checking…" : "Add realtor"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
