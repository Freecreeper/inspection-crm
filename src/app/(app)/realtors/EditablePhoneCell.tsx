"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatPhone, isValidPhoneInput } from "@/lib/phone";
import { CellActionsMenu, type CellAction } from "@/components/CellActionsMenu";

// Same edit shell as EditableCell, but with the live as-you-type
// formatting and 10-digit validation already used by PhoneInput (the New
// Realtor form) and PhoneField (the quick-create popups) — kept as its
// own component rather than a prop on the generic EditableCell since the
// formatting-on-every-keystroke behavior is specific to phone numbers.
// Clicking the displayed value opens a stacked-actions popup (Call/Text
// plus "Edit") rather than editing directly.
export function EditablePhoneCell({
  phone,
  onSave,
  actions,
}: {
  phone: string | null;
  onSave: (phone: string) => Promise<void>;
  actions: CellAction[];
}) {
  const displayValue = formatPhone(phone);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
      committedRef.current = false;
    }
  }, [editing]);

  function commit() {
    if (committedRef.current) return;
    if (!isValidPhoneInput(draft)) {
      setError("Phone number must have 10 digits.");
      return;
    }
    committedRef.current = true;
    if (draft === displayValue) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onSave(draft);
        setEditing(false);
      } catch (err) {
        committedRef.current = false;
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  function cancel() {
    committedRef.current = true;
    setDraft(displayValue);
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <CellActionsMenu
        trigger={
          <span className="block w-full truncate">
            {displayValue || <span className="text-slate-400">Not provided</span>}
          </span>
        }
        actions={[
          ...actions,
          {
            label: "Edit",
            onClick: () => {
              setDraft(displayValue);
              setEditing(true);
            },
          },
        ]}
      />
    );
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="tel"
        inputMode="numeric"
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(formatPhone(e.target.value))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        placeholder="(555)123-4567"
        className="w-full rounded border border-emerald-400 px-1 py-0.5 text-sm focus:outline-none"
      />
      {error && (
        <p className="absolute left-0 top-full z-10 mt-0.5 w-max max-w-[200px] rounded bg-white px-1.5 py-0.5 text-xs text-red-600 shadow">
          {error}
        </p>
      )}
    </div>
  );
}
