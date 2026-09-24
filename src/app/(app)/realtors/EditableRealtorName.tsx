"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CellActionsMenu, type CellAction } from "@/components/CellActionsMenu";

// Edits firstName/lastName together as one "Full Name" text field, split
// on the first run of whitespace — firstName is everything before it,
// lastName is everything after. A single combined field reads naturally
// in a narrow table cell; two side-by-side inputs would fight the
// column's width. Clicking the displayed name opens a stacked-actions
// popup (Profile plus "Edit") rather than editing directly.
export function EditableRealtorName({
  firstName,
  lastName,
  onSave,
  actions,
}: {
  firstName: string;
  lastName: string;
  // Takes a single { firstName, lastName } object (rather than two
  // positional args) so the page can pass a bound server action straight
  // through as a prop — a plain wrapper closure isn't a valid server
  // action reference and can't cross the server/client boundary.
  onSave: (data: { firstName: string; lastName: string }) => Promise<void>;
  actions: CellAction[];
}) {
  const fullName = `${firstName} ${lastName}`;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fullName);
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
    const trimmed = draft.trim();
    const parts = trimmed.split(/\s+/);
    const newFirst = parts[0] ?? "";
    const newLast = parts.slice(1).join(" ");
    if (!newFirst || !newLast) {
      setError("Enter a first and last name.");
      return;
    }
    committedRef.current = true;
    if (newFirst === firstName && newLast === lastName) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onSave({ firstName: newFirst, lastName: newLast });
        setEditing(false);
      } catch (err) {
        committedRef.current = false;
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  function cancel() {
    committedRef.current = true;
    setDraft(fullName);
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <CellActionsMenu
        trigger={
          // Stacked rather than one truncated "First Last" line — the
          // column is narrow enough that a long name would otherwise get
          // cut off; the row just grows to fit both lines instead.
          <div className="font-medium text-slate-900">
            <span className="block truncate">{firstName}</span>
            <span className="block truncate">{lastName}</span>
          </div>
        }
        actions={[
          ...actions,
          {
            label: "Edit",
            onClick: () => {
              setDraft(fullName);
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
        className="w-full rounded border border-emerald-400 px-1 py-0.5 text-sm font-medium text-slate-900 focus:outline-none"
      />
      {error && (
        <p className="absolute left-0 top-full z-10 mt-0.5 w-max max-w-[200px] rounded bg-white px-1.5 py-0.5 text-xs text-red-600 shadow">
          {error}
        </p>
      )}
    </div>
  );
}
