"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CellActionsMenu, type CellAction } from "./CellActionsMenu";

// A table cell whose displayed value opens a stacked-actions popup
// (Call/Email/... plus "Edit", supplied by the caller) rather than
// jumping straight into edit mode. Picking "Edit" from that popup is what
// flips this into the same in-place editor as before — save on
// blur/Enter, revert on Escape. `onSave` is whatever server action
// actually persists the change — this component only owns the editing
// UI, not the update logic, so each caller can validate/normalize however
// that field needs to.
export function EditableCell({
  value,
  placeholder = "Not provided",
  type = "text",
  onSave,
  actions,
  className = "",
  inputClassName = "",
}: {
  value: string;
  placeholder?: string;
  type?: "text" | "email";
  onSave: (value: string) => Promise<void>;
  // Non-"Edit" actions for this cell's popup (e.g. Email/Template Email) —
  // "Edit" itself is appended automatically below.
  actions: CellAction[];
  className?: string;
  inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
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
    committedRef.current = true;
    if (draft === value) {
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
    setDraft(value);
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <CellActionsMenu
        trigger={
          <span className={`block w-full truncate ${className}`}>
            {value || <span className="text-slate-400">{placeholder}</span>}
          </span>
        }
        actions={[
          ...actions,
          {
            label: "Edit",
            onClick: () => {
              setDraft(value);
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
        type={type}
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
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
        className={`w-full rounded border border-emerald-400 px-1 py-0.5 text-sm focus:outline-none ${inputClassName}`}
      />
      {error && (
        <p className="absolute left-0 top-full z-10 mt-0.5 w-max max-w-[200px] rounded bg-white px-1.5 py-0.5 text-xs text-red-600 shadow">
          {error}
        </p>
      )}
    </div>
  );
}
