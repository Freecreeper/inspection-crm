"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Pencil } from "lucide-react";

export type SaveResult = { ok: true } | { ok: false; error: string };

type EditorProps =
  | { editor?: "text" | "email" | "tel"; options?: never }
  | { editor: "textarea"; options?: never }
  | { editor: "select"; options: { value: string; label: string }[] };

// Click-to-edit for one field at a time: the value reads as plain text with
// a small pencil button; editing changes only this field. The save callback
// is a server action that owns validation and permission checks — this
// component just shows its answer.
export function InlineField({
  label,
  value,
  display,
  emptyText = "Not provided",
  canEdit,
  onSave,
  formatInput,
  editor = "text",
  options,
}: {
  label: string;
  value: string;
  display?: React.ReactNode;
  emptyText?: string;
  canEdit: boolean;
  onSave: (value: string) => Promise<SaveResult>;
  formatInput?: (value: string) => string;
} & EditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const errorId = useId();

  // Focus the input on entering edit mode, and again after a failed save —
  // it's disabled while saving, which drops focus, and the user needs it
  // back to correct the value (and so Escape still reaches this field).
  useEffect(() => {
    if (editing && !pending) inputRef.current?.focus();
  }, [editing, pending, error]);

  // Leaving edit mode puts focus back on this field's pencil button.
  const restoreFocusRef = useRef(false);
  useEffect(() => {
    if (!editing && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  function startEditing() {
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  function stopEditing() {
    setEditing(false);
    setError(null);
    restoreFocusRef.current = true;
  }

  function save() {
    if (draft === value) {
      stopEditing();
      return;
    }
    startTransition(async () => {
      const result = await onSave(draft);
      if (result.ok) stopEditing();
      else setError(result.error);
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stopEditing();
    } else if (e.key === "Enter" && editor !== "textarea") {
      e.preventDefault();
      save();
    }
  }

  if (!editing) {
    return (
      <div className="group">
        <dt className="text-xs text-slate-500">{label}</dt>
        <dd className="mt-0.5 flex min-w-0 items-start gap-1.5 text-sm text-slate-900">
          <span className="min-w-0 break-words">{value ? (display ?? value) : <span className="text-slate-400">{emptyText}</span>}</span>
          {canEdit && (
            <button
              ref={editButtonRef}
              type="button"
              onClick={startEditing}
              aria-label={`Edit ${label.toLowerCase()}`}
              className="-my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-emerald-600"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </dd>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
  const common = {
    id: inputId,
    disabled: pending,
    onKeyDown,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
  };

  return (
    <div>
      <label htmlFor={inputId} className="text-xs text-slate-500">
        {label}
      </label>
      <div className="mt-1 space-y-2">
        {editor === "textarea" ? (
          <textarea ref={inputRef} rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} className={inputClass} {...common} />
        ) : editor === "select" ? (
          <select ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} className={inputClass} {...common}>
            {options!.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={inputRef}
            type={editor}
            inputMode={editor === "tel" ? "numeric" : undefined}
            value={draft}
            onChange={(e) => setDraft(formatInput ? formatInput(e.target.value) : e.target.value)}
            className={inputClass}
            {...common}
          />
        )}
        {error && (
          <p id={errorId} role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={stopEditing} disabled={pending} className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
