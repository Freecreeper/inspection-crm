"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAgreementWordingAction } from "./actions";

const input = "mt-1 w-full rounded-md border border-input px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";

export function AgreementEditor({
  title: initialTitle,
  body: initialBody,
  isDefault,
  defaultBody,
  maxLength,
  variables,
}: {
  title: string;
  body: string;
  isDefault: boolean;
  defaultBody: string;
  maxLength: number;
  variables: { key: string; label: string }[];
}) {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = title !== initialTitle || body !== initialBody;

  const save = (nextBody: string) => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await saveAgreementWordingAction({ title, body: nextBody });
        if (!result.ok) return setMessage({ ok: false, text: result.error });
        setMessage({ ok: true, text: "Saved. New signature requests use this wording." });
        router.refresh();
      } catch {
        setMessage({ ok: false, text: "Couldn't save. Only an owner can change the agreement." });
      }
    });
  };

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        // Saving the untouched placeholder keeps it a placeholder.
        save(isDefault && body === defaultBody ? "" : body);
      }}
    >
      <label htmlFor={`${id}-title`} className="block text-sm font-medium text-neutral-800">
        Title
        <input id={`${id}-title`} value={title} maxLength={120} disabled={pending} onChange={(e) => setTitle(e.target.value)} className={input} />
      </label>
      <label htmlFor={`${id}-body`} className="block text-sm font-medium text-neutral-800">
        Agreement text
        <textarea id={`${id}-body`} rows={24} value={body} maxLength={maxLength} disabled={pending} onChange={(e) => setBody(e.target.value)} className={`${input} font-mono text-[13px] leading-5`} />
      </label>
      <details className="rounded-md border border-border bg-surface p-3 text-sm">
        <summary className="cursor-pointer font-medium text-neutral-800">Placeholders you can use</summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Write <code>{"{{customer.fullName}}"}</code>, or add a fallback for when it isn&apos;t on file: <code>{'{{inspection.fee | "as quoted"}}'}</code>. One with no value and no fallback becomes a blank line (________).
        </p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {variables.map((v) => (
            <li key={v.key} className="text-xs text-neutral-700">
              <code className="rounded bg-surface-secondary px-1">{`{{${v.key}}}`}</code> {v.label}
            </li>
          ))}
        </ul>
      </details>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-success-strong" : "text-danger-strong"}`}>
          {message.text}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending || !changed} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
        {!isDefault && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Go back to the placeholder wording? Agreements already sent keep their text.")) return;
              setBody(defaultBody);
              save("");
            }}
            className="rounded-md border border-input bg-surface px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-hover"
          >
            Restore placeholder
          </button>
        )}
      </div>
    </form>
  );
}
