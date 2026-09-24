"use client";

import { useState, useTransition } from "react";
import { createBrokerageInline } from "../brokerages/actions";
import { formatPhone, isValidPhoneInput } from "@/lib/phone";

const ADD_NEW_VALUE = "__add_new__";

export function BrokerageSelect({
  name,
  initialBrokerages,
}: {
  name: string;
  initialBrokerages: { id: string; name: string }[];
}) {
  const [brokerages, setBrokerages] = useState(initialBrokerages);
  const [selectedId, setSelectedId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function closeModal() {
    setModalOpen(false);
    setNewName("");
    setNewPhone("");
    setError(null);
  }

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value === ADD_NEW_VALUE) {
      setModalOpen(true);
      return;
    }
    setSelectedId(e.target.value);
  }

  function handleCreateBrokerage() {
    setError(null);
    if (!newName.trim()) {
      setError("Brokerage name is required.");
      return;
    }
    if (!isValidPhoneInput(newPhone)) {
      setError("Phone number must have 10 digits.");
      return;
    }
    startTransition(async () => {
      try {
        const created = await createBrokerageInline({ name: newName, phone: newPhone });
        setBrokerages((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        setSelectedId(created.id);
        closeModal();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create brokerage.");
      }
    });
  }

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">Brokerage (optional)</label>
      <select
        name={name}
        value={selectedId}
        onChange={handleSelectChange}
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
      >
        <option value="">No brokerage</option>
        {brokerages.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
        <option value={ADD_NEW_VALUE}>+ Add new brokerage</option>
      </select>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-900">New brokerage</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700">Name</label>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <PhoneInputControlled label="Phone (optional)" value={newPhone} onChange={setNewPhone} />
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={handleCreateBrokerage}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {pending ? "Adding…" : "Add brokerage"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// The modal's phone field is a controlled value owned by this file (its
// value has to survive the modal's own submit-and-clear cycle), so it uses
// the same formatting as <PhoneInput> without that component's own
// uncontrolled internal state.
function PhoneInputControlled({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <input
        type="tel"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(formatPhone(e.target.value))}
        placeholder="(555)123-4567"
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
    </div>
  );
}
