"use client";

import { useState } from "react";
import { createRealtor } from "../actions";
import { BrokerageCombobox } from "../BrokerageCombobox";
import { PhoneInput } from "../PhoneInput";
import { isValidPhoneInput } from "@/lib/phone";

export function NewRealtorForm({ brokerages }: { brokerages: { id: string; name: string }[] }) {
  const [phoneForceShowError, setPhoneForceShowError] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    // PhoneInput shows its own inline error once the field has been
    // blurred — forceShowError covers submitting before that ever happens
    // (e.g. the field was never individually focused).
    const phone = String(new FormData(e.currentTarget).get("phone") ?? "");
    if (!isValidPhoneInput(phone)) {
      e.preventDefault();
      setPhoneForceShowError(true);
    }
  }

  return (
    <form action={createRealtor} onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700">First name</label>
          <input name="firstName" required className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Last name</label>
          <input name="lastName" required className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Email (optional)</label>
        <input name="email" type="email" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
      </div>
      <PhoneInput name="phone" forceShowError={phoneForceShowError} />
      <div>
        <label className="block text-sm font-medium text-slate-700">Brokerage (optional)</label>
        <div className="mt-1">
          <BrokerageCombobox name="brokerageId" options={brokerages.map((b) => ({ id: b.id, label: b.name }))} />
        </div>
      </div>
      <button type="submit" className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
        Add realtor
      </button>
    </form>
  );
}
