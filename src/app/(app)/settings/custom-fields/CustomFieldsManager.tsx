"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomFieldDataType, CustomFieldEntityType } from "@prisma/client";
import { CUSTOM_FIELD_ENTITIES, DATA_TYPE_LABELS, DATA_TYPES, EDITABLE_ENTITY_TYPES, hasOptions, MAX_LABEL } from "@/lib/customFields/shared";
import { createFieldAction, deleteFieldAction, moveFieldAction, setFieldActiveAction, updateFieldAction } from "./actions";

export interface ManagedField {
  id: string;
  entityType: CustomFieldEntityType;
  label: string;
  fieldKey: string;
  dataType: CustomFieldDataType;
  options: string[];
  required: boolean;
  active: boolean;
  valueCount: number;
}

type Result = { ok: true } | { ok: false; error: string };

const input = "mt-1 w-full rounded-md border border-input px-2 py-1.5 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const smallButton = "rounded-md border border-input bg-surface px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-hover disabled:opacity-50";

export function CustomFieldsManager({ fields }: { fields: ManagedField[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<Result>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) return setError(result.error);
        after?.();
        router.refresh();
      } catch {
        setError("Something went wrong, or you may not have permission to manage custom fields.");
      }
    });
  };

  // Kinds not shown on any screen appear only if fields already exist for them.
  const sections = CUSTOM_FIELD_ENTITIES.filter((e) => e.shownOn || fields.some((f) => f.entityType === e.type));

  return (
    <div className="mt-6 space-y-6">
      <AddField disabled={pending} onAdd={(data, done) => run(() => createFieldAction(data), done)} />
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
          {error}
        </p>
      )}
      {sections.map((section) => {
        const list = fields.filter((f) => f.entityType === section.type);
        return (
          <section key={section.type} aria-labelledby={`cf-${section.type}`} className="rounded-lg border border-border bg-surface">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-100 px-4 py-3">
              <h2 id={`cf-${section.type}`} className="text-sm font-semibold text-foreground">
                {section.label}
              </h2>
              <p className="text-xs text-muted-foreground">{section.shownOn ? `Shown on ${section.shownOn}` : "Not shown on any page yet"}</p>
            </div>
            {list.length === 0 ? (
              <p className="px-4 py-4 text-sm text-subtle">No fields yet.</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {list.map((f, i) => (
                  <FieldRow
                    key={f.id}
                    field={f}
                    first={i === 0}
                    last={i === list.length - 1}
                    disabled={pending}
                    onSave={(data, done) => run(() => updateFieldAction(f.id, data), done)}
                    onMove={(dir) => run(() => moveFieldAction(f.id, dir))}
                    onActive={(active) => run(() => setFieldActiveAction(f.id, active))}
                    onDelete={() => {
                      if (!window.confirm(`Delete "${f.label}"? It isn't filled in on any record.`)) return;
                      run(() => deleteFieldAction(f.id));
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function AddField({ disabled, onAdd }: { disabled: boolean; onAdd: (data: { entityType: string; label: string; dataType: string; options: string; required: boolean }, done: () => void) => void }) {
  const id = useId();
  const [entityType, setEntityType] = useState<string>(EDITABLE_ENTITY_TYPES[0]);
  const [label, setLabel] = useState("");
  const [dataType, setDataType] = useState<CustomFieldDataType>("TEXT");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  return (
    <form
      className="rounded-lg border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd({ entityType, label, dataType, options, required }, () => {
          setLabel("");
          setOptions("");
          setRequired(false);
        });
      }}
    >
      <h2 className="text-sm font-semibold text-foreground">Add a field</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label htmlFor={`${id}-entity`} className="text-xs font-medium text-neutral-700">
          For
          <select id={`${id}-entity`} value={entityType} disabled={disabled} onChange={(e) => setEntityType(e.target.value)} className={input}>
            {CUSTOM_FIELD_ENTITIES.filter((e) => e.shownOn).map((e) => (
              <option key={e.type} value={e.type}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-label`} className="text-xs font-medium text-neutral-700">
          Name
          <input id={`${id}-label`} value={label} maxLength={MAX_LABEL} disabled={disabled} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Foundation type" className={input} />
        </label>
        <label htmlFor={`${id}-type`} className="text-xs font-medium text-neutral-700">
          Type
          <select id={`${id}-type`} value={dataType} disabled={disabled} onChange={(e) => setDataType(e.target.value as CustomFieldDataType)} className={input}>
            {DATA_TYPES.map((t) => (
              <option key={t} value={t}>
                {DATA_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {hasOptions(dataType) && (
        <label htmlFor={`${id}-options`} className="mt-3 block text-xs font-medium text-neutral-700">
          Choices <span className="font-normal text-muted-foreground">(one per line)</span>
          <textarea id={`${id}-options`} rows={3} value={options} disabled={disabled} onChange={(e) => setOptions(e.target.value)} placeholder={"Slab\nCrawlspace\nBasement"} className={input} />
        </label>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={required} disabled={disabled} onChange={(e) => setRequired(e.target.checked)} />
          Required
        </label>
        <button type="submit" disabled={disabled || !label.trim()} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60">
          Add field
        </button>
      </div>
    </form>
  );
}

function FieldRow({
  field,
  first,
  last,
  disabled,
  onSave,
  onMove,
  onActive,
  onDelete,
}: {
  field: ManagedField;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onSave: (data: { label: string; options?: string; required: boolean }, done: () => void) => void;
  onMove: (direction: -1 | 1) => void;
  onActive: (active: boolean) => void;
  onDelete: () => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(field.label);
  const [options, setOptions] = useState(field.options.join("\n"));
  const [required, setRequired] = useState(field.required);

  if (editing) {
    return (
      <li className="px-4 py-3">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ label, options: hasOptions(field.dataType) ? options : undefined, required }, () => setEditing(false));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor={`${id}-label`} className="text-xs font-medium text-neutral-700">
              Name
              <input id={`${id}-label`} value={label} maxLength={MAX_LABEL} disabled={disabled} onChange={(e) => setLabel(e.target.value)} className={input} />
            </label>
            <p className="text-xs text-muted-foreground sm:pt-6">Type: {DATA_TYPE_LABELS[field.dataType]} (can&apos;t change)</p>
          </div>
          {hasOptions(field.dataType) && (
            <label htmlFor={`${id}-options`} className="block text-xs font-medium text-neutral-700">
              Choices <span className="font-normal text-muted-foreground">(one per line; removing one keeps it on records that already have it)</span>
              <textarea id={`${id}-options`} rows={4} value={options} disabled={disabled} onChange={(e) => setOptions(e.target.value)} className={input} />
            </label>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={required} disabled={disabled} onChange={(e) => setRequired(e.target.checked)} />
              Required
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={disabled} onClick={() => setEditing(false)} className={smallButton}>
                Cancel
              </button>
              <button type="submit" disabled={disabled} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60">
                Save
              </button>
            </div>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${field.active ? "" : "bg-surface-secondary"}`}>
      <div className="min-w-0">
        <p className={`text-sm font-medium ${field.active ? "text-foreground" : "text-neutral-500"}`}>
          {field.label}
          {field.required && <span className="ml-2 text-xs font-normal text-neutral-600">Required</span>}
          {!field.active && <span className="ml-2 text-xs font-normal text-neutral-600">Off — hidden from records</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {DATA_TYPE_LABELS[field.dataType]}
          {field.options.length > 0 && ` · ${field.options.join(", ")}`} · filled in on {field.valueCount} record{field.valueCount === 1 ? "" : "s"}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={disabled || first} onClick={() => onMove(-1)} aria-label={`Move ${field.label} up`} className={smallButton}>
          ↑
        </button>
        <button type="button" disabled={disabled || last} onClick={() => onMove(1)} aria-label={`Move ${field.label} down`} className={smallButton}>
          ↓
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setLabel(field.label);
            setOptions(field.options.join("\n"));
            setRequired(field.required);
            setEditing(true);
          }}
          className={smallButton}
        >
          Edit
        </button>
        <button type="button" disabled={disabled} onClick={() => onActive(!field.active)} className={smallButton}>
          {field.active ? "Turn off" : "Turn on"}
        </button>
        {field.valueCount === 0 && (
          <button type="button" disabled={disabled} onClick={onDelete} className={`${smallButton} text-danger-strong`}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
