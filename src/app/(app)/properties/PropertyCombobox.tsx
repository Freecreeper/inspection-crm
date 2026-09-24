"use client";

import { useMemo, useState, useTransition } from "react";
import { Combobox, type ComboboxOption } from "@/components/Combobox";
import { sortAlphabetically } from "@/lib/sort";
import { createPropertyInline } from "./actions";

export function PropertyCombobox({
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
      placeholder="Search properties…"
      createNewLabel="+ Add new property"
      renderCreateNew={({ onCreated, onCancel }) => <CreatePropertyForm onCreated={onCreated} onCancel={onCancel} />}
    />
  );
}

function CreatePropertyForm({
  onCreated,
  onCancel,
}: {
  onCreated: (option: ComboboxOption) => void;
  onCancel: () => void;
}) {
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    if (!addressLine1.trim() || !city.trim() || !state.trim() || !zip.trim()) {
      return setError("Address, city, state, and zip are required.");
    }
    startTransition(async () => {
      try {
        const created = await createPropertyInline({ addressLine1, city, state, zip });
        onCreated({ id: created.id, label: created.label });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create property.");
      }
    });
  }

  return (
    <>
      <h2 className="text-sm font-semibold text-slate-900">New property</h2>
      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-slate-700">Address</label>
          <input
            autoFocus
            value={addressLine1}
            onChange={(e) => setAddressLine1(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-1">
            <label className="block text-sm font-medium text-slate-700">City</label>
            <input value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">State</label>
            <input value={state} onChange={(e) => setState(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Zip</label>
            <input value={zip} onChange={(e) => setZip(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
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
          {pending ? "Adding…" : "Add property"}
        </button>
      </div>
    </>
  );
}
