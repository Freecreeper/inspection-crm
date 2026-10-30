"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomFieldDataType } from "@prisma/client";
import { saveRecordFieldsAction } from "@/app/(app)/settings/custom-fields/actions";
import type { FieldInput } from "@/lib/customFields/shared";

export interface PanelField {
  id: string;
  label: string;
  dataType: CustomFieldDataType;
  options: string[];
  required: boolean;
  display: string;
  input: FieldInput;
}

const input = "mt-1 w-full rounded-md border border-input px-2 py-1.5 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";

// A record's custom fields: read as a list, edited all together, saved in
// one go (the server validates everything and saves nothing if any is wrong).
export function CustomFieldsPanel({ entityType, entityId, title, fields, canEdit, bare = false }: { entityType: string; entityId: string; title: string; fields: PanelField[]; canEdit: boolean; bare?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, FieldInput>>(() => Object.fromEntries(fields.map((f) => [f.id, f.input])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const filled = fields.filter((f) => f.display);

  const start = () => {
    setValues(Object.fromEntries(fields.map((f) => [f.id, f.input])));
    setErrors({});
    setError(null);
    setEditing(true);
  };

  const body = editing ? (
    <form
      className="mt-2 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setErrors({});
        startTransition(async () => {
          try {
            const result = await saveRecordFieldsAction(entityType, entityId, values);
            if (!result.ok) {
              setErrors(result.fieldErrors ?? {});
              return setError(result.fieldErrors ? "Check the highlighted fields." : result.error);
            }
            setEditing(false);
            router.refresh();
          } catch {
            setError("Couldn't save. You may not have permission to change these fields.");
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <FieldEditor key={f.id} field={f} value={values[f.id]} error={errors[f.id]} disabled={pending} onChange={(v) => setValues((prev) => ({ ...prev, [f.id]: v }))} />
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-strong">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={pending} onClick={() => setEditing(false)} className="rounded-md border border-input bg-surface px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-hover">
          Cancel
        </button>
      </div>
    </form>
  ) : (
    <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.id}>
          <dt className="text-xs text-muted-foreground">{f.label}</dt>
          <dd className={f.display ? "text-neutral-800" : f.required ? "text-warning-strong" : "text-subtle"}>{f.display || (f.required ? "Required — not filled in" : "—")}</dd>
        </div>
      ))}
    </dl>
  );

  const header = (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-foreground">
        {title}
        {!editing && fields.length > 0 && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {filled.length} of {fields.length} filled in
          </span>
        )}
      </h2>
      {canEdit && !editing && (
        <button type="button" onClick={start} className="rounded-md border border-input bg-surface px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-hover">
          Edit
        </button>
      )}
    </div>
  );

  if (bare) {
    return (
      <div className="mt-3 border-t border-neutral-100 pt-3">
        {header}
        {body}
      </div>
    );
  }
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      {header}
      {body}
    </section>
  );
}

function FieldEditor({ field, value, error, disabled, onChange }: { field: PanelField; value: FieldInput; error?: string; disabled: boolean; onChange: (v: FieldInput) => void }) {
  const id = useId();
  const described = error ? `${id}-err` : undefined;
  const invalid = error ? true : undefined;
  const label = (
    <span className="text-xs font-medium text-neutral-700">
      {field.label}
      {field.required && (
        <span className="text-danger-strong" aria-hidden="true">
          {" "}
          *
        </span>
      )}
    </span>
  );
  let control: React.ReactNode;
  switch (field.dataType) {
    case "TEXT":
      control = <input id={id} value={String(value ?? "")} maxLength={500} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={described} aria-required={field.required} className={input} />;
      break;
    case "NUMBER":
      control = <input id={id} inputMode="decimal" value={String(value ?? "")} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={described} aria-required={field.required} className={input} />;
      break;
    case "DATE":
      control = <input id={id} type="date" value={String(value ?? "")} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={described} aria-required={field.required} className={input} />;
      break;
    case "BOOLEAN":
    case "SELECT": {
      const choices = field.dataType === "BOOLEAN" ? [["true", "Yes"], ["false", "No"]] : withCurrent(field.options, String(value ?? "")).map((o) => [o, o]);
      control = (
        <select id={id} value={String(value ?? "")} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={described} aria-required={field.required} className={input}>
          <option value="">{field.required ? "Choose…" : "Not set"}</option>
          {choices.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </select>
      );
      break;
    }
    case "MULTISELECT": {
      const picked = Array.isArray(value) ? value : [];
      return (
        <fieldset aria-describedby={described} aria-invalid={invalid}>
          <legend>{label}</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {withCurrent(field.options, ...picked).map((o) => (
              <label key={o} className="inline-flex items-center gap-1.5 text-sm text-neutral-800">
                <input type="checkbox" checked={picked.includes(o)} disabled={disabled} onChange={(e) => onChange(e.target.checked ? [...picked, o] : picked.filter((p) => p !== o))} />
                {o}
              </label>
            ))}
          </div>
          {error && (
            <p id={described} className="mt-1 text-xs text-danger-strong">
              {error}
            </p>
          )}
        </fieldset>
      );
    }
  }
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {control}
      {error && (
        <p id={described} className="mt-1 text-xs text-danger-strong">
          {error}
        </p>
      )}
    </div>
  );
}

// A value saved before its choice was removed from the field stays choosable.
function withCurrent(options: string[], ...current: string[]): string[] {
  return [...options, ...current.filter((c) => c && !options.includes(c))];
}
