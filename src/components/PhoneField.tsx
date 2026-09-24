"use client";

import { formatPhone } from "@/lib/phone";

// A controlled phone input for callers that already own the value in
// their own state (a modal that has to hand the raw value to a server
// action on submit) — src/app/(app)/realtors/PhoneInput.tsx is the
// uncontrolled, form-field version of the same formatting behavior for a
// plain <form action={serverAction}>.
export function PhoneField({
  label = "Phone (optional)",
  value,
  onChange,
}: {
  label?: string;
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
