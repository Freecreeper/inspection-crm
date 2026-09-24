"use client";

import { useMemo, useState, useTransition } from "react";
import { Combobox, type ComboboxOption } from "@/components/Combobox";
import { PhoneField } from "@/components/PhoneField";
import { isValidPhoneInput } from "@/lib/phone";
import { sortAlphabetically } from "@/lib/sort";
import { createBrokerageInline } from "../brokerages/actions";

export function BrokerageCombobox({
  name,
  options,
  defaultValue,
  onSelect,
}: {
  name: string;
  options: ComboboxOption[];
  defaultValue?: string;
  onSelect?: (option: ComboboxOption | null) => void;
}) {
  const sortedOptions = useMemo(() => sortAlphabetically(options, (o) => o.label), [options]);
  return (
    <Combobox
      name={name}
      options={sortedOptions}
      defaultValue={defaultValue}
      placeholder="Search brokerages…"
      createNewLabel="+ Add new brokerage"
      onSelect={onSelect}
      renderCreateNew={({ onCreated, onCancel }) => <CreateBrokerageForm onCreated={onCreated} onCancel={onCancel} />}
    />
  );
}

function CreateBrokerageForm({
  onCreated,
  onCancel,
}: {
  onCreated: (option: ComboboxOption) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    if (!name.trim()) return setError("Brokerage name is required.");
    if (!isValidPhoneInput(phone)) return setError("Phone number must have 10 digits.");
    startTransition(async () => {
      try {
        const created = await createBrokerageInline({ name, phone });
        onCreated({ id: created.id, label: created.name });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create brokerage.");
      }
    });
  }

  return (
    <>
      <h2 className="text-sm font-semibold text-slate-900">New brokerage</h2>
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
        <PhoneField value={phone} onChange={setPhone} />
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
          {pending ? "Adding…" : "Add brokerage"}
        </button>
      </div>
    </>
  );
}
