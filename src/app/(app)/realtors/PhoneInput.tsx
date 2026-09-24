"use client";

import { useState } from "react";
import { formatPhone, isValidPhoneInput } from "@/lib/phone";

export function PhoneInput({
  name,
  defaultValue,
  label = "Phone (optional)",
  forceShowError = false,
}: {
  name: string;
  defaultValue?: string;
  label?: string;
  // Set by a parent form after a blocked submit attempt, so the error
  // shows even if the field was never individually blurred (e.g. the user
  // never focused it before hitting submit).
  forceShowError?: boolean;
}) {
  const [value, setValue] = useState(formatPhone(defaultValue));
  const [touched, setTouched] = useState(false);
  const valid = isValidPhoneInput(value);
  const showError = (touched || forceShowError) && !valid;

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <input
        name={name}
        type="tel"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(formatPhone(e.target.value))}
        onBlur={() => setTouched(true)}
        placeholder="(555)123-4567"
        className={`mt-1 w-full rounded-md border px-2 py-1.5 text-sm ${
          showError ? "border-red-400 focus:border-red-500" : "border-slate-300"
        }`}
      />
      {showError && <p className="mt-1 text-xs text-red-600">Phone number must have 10 digits.</p>}
    </div>
  );
}
