"use client";

import { useId } from "react";
import { formatPhone } from "@/lib/phone";

// A controlled phone input for callers that already own the value in
// their own state (a modal that has to hand the raw value to a server
// action on submit), formatting as the user types.
export function PhoneField({
  label = "Phone (optional)",
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
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
