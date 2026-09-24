"use client";

import { useMemo, useState, useTransition } from "react";
import { Combobox, type ComboboxOption } from "@/components/Combobox";
import { sortAlphabetically } from "@/lib/sort";
import { createReferralSourceInline } from "./actions";

export function ReferralSourceCombobox({
  name,
  options,
  defaultValue,
}: {
  name: string;
  options: ComboboxOption[];
  defaultValue?: string;
}) {
  const sortedOptions = useMemo(() => sortAlphabetically(options, (o) => o.label), [options]);
  return (
    <Combobox
      name={name}
      options={sortedOptions}
      defaultValue={defaultValue}
      placeholder="Search referral sources…"
      createNewLabel="+ Add new referral source"
      renderCreateNew={({ onCreated, onCancel }) => <CreateReferralSourceForm onCreated={onCreated} onCancel={onCancel} />}
    />
  );
}

function CreateReferralSourceForm({
  onCreated,
  onCancel,
}: {
  onCreated: (option: ComboboxOption) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    if (!name.trim() || !type.trim()) return setError("Name and type are required.");
    startTransition(async () => {
      try {
        const created = await createReferralSourceInline({ name, type });
        onCreated({ id: created.id, label: created.label });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create referral source.");
      }
    });
  }

  return (
    <>
      <h2 className="text-sm font-semibold text-slate-900">New referral source</h2>
      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-slate-700">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Type</label>
          <input
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="e.g. Realtor, Past Customer, Online"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={handleSubmit}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add referral source"}
        </button>
      </div>
    </>
  );
}
