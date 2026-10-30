// Pure (client-safe): custom field rules shared by the settings screen, the
// record panels and the server. A field belongs to one kind of record, has
// a fixed data type, and its value is validated here before it's stored.

import type { CustomFieldDataType, CustomFieldEntityType } from "@prisma/client";
import { dayKeyToDateOnly, isDayKey } from "@/lib/calendar/time";

export const CUSTOM_FIELD_ENTITIES: { type: CustomFieldEntityType; label: string; singular: string; shownOn: string | null }[] = [
  { type: "PROPERTY", label: "Properties", singular: "property", shownOn: "transaction and inspection pages" },
  { type: "CUSTOMER", label: "Customers", singular: "customer", shownOn: "customer pages" },
  { type: "TRANSACTION", label: "Transactions", singular: "transaction", shownOn: "transaction pages" },
  { type: "INSPECTION", label: "Inspections", singular: "inspection", shownOn: "inspection pages" },
  // Not on any screen yet: the report editor doesn't show custom fields.
  { type: "REPORT", label: "Reports", singular: "report", shownOn: null },
  { type: "REPORT_SECTION", label: "Report sections", singular: "report section", shownOn: null },
  { type: "REPORT_COMPONENT", label: "Report components", singular: "report component", shownOn: null },
  { type: "FINDING", label: "Findings", singular: "finding", shownOn: null },
];

// The kinds of record a new field can be added to (ones shown on a screen).
export const EDITABLE_ENTITY_TYPES = CUSTOM_FIELD_ENTITIES.filter((e) => e.shownOn).map((e) => e.type);

export const DATA_TYPE_LABELS: Record<CustomFieldDataType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  BOOLEAN: "Yes / no",
  SELECT: "Pick one",
  MULTISELECT: "Pick several",
};
export const DATA_TYPES = Object.keys(DATA_TYPE_LABELS) as CustomFieldDataType[];

export const MAX_LABEL = 60;
export const MAX_OPTIONS = 30;
export const MAX_OPTION_LENGTH = 60;
export const MAX_TEXT_VALUE = 500;

export function hasOptions(dataType: CustomFieldDataType): boolean {
  return dataType === "SELECT" || dataType === "MULTISELECT";
}

// The stored key, made once from the label and never changed afterward.
export function fieldKeyFromLabel(label: string): string {
  const key = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/, "");
  return key || "field";
}

// Options as typed: one per line or comma-separated, trimmed, without
// blanks or (case-insensitive) duplicates, in the order given.
export function parseOptions(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[\n,]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const option = p.trim().replace(/\s+/g, " ");
    if (!option || seen.has(option.toLowerCase())) continue;
    seen.add(option.toLowerCase());
    out.push(option);
  }
  return out;
}

export function optionsOf(options: unknown): string[] {
  return Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : [];
}

// What the browser sends for one field: text, number and date as strings,
// yes/no as "true" / "false" / "" (not answered), pick-several as a list.
export type FieldInput = string | string[] | boolean | null | undefined;

export interface StoredValue {
  value: string | number | boolean | string[];
  valueText: string | null;
  valueNumber: string | null;
  valueDate: Date | null;
}

export type ParseResult = { ok: true; value: StoredValue | null } | { ok: false; error: string };

const NUMBER = /^-?\d{1,14}(\.\d{1,4})?$/;

// `current` is the value already stored, so an option that has since been
// removed from the field can still be kept on the records that have it.
export function parseFieldValue(field: { label: string; dataType: CustomFieldDataType; options: unknown }, raw: FieldInput, current?: unknown): ParseResult {
  const bad = (why: string): ParseResult => ({ ok: false, error: `${field.label}: ${why}` });
  switch (field.dataType) {
    case "TEXT": {
      const text = String(raw ?? "").trim();
      if (!text) return { ok: true, value: null };
      if (text.length > MAX_TEXT_VALUE) return bad(`keep it under ${MAX_TEXT_VALUE} characters.`);
      return { ok: true, value: { value: text, valueText: text, valueNumber: null, valueDate: null } };
    }
    case "NUMBER": {
      const text = String(raw ?? "").trim().replace(/[,\s$]/g, "");
      if (!text) return { ok: true, value: null };
      if (!NUMBER.test(text)) return bad("enter a number, like 1250 or 3.5.");
      return { ok: true, value: { value: Number(text), valueText: null, valueNumber: text, valueDate: null } };
    }
    case "DATE": {
      const day = String(raw ?? "").trim();
      if (!day) return { ok: true, value: null };
      if (!isDayKey(day)) return bad("pick a valid date.");
      return { ok: true, value: { value: day, valueText: null, valueNumber: null, valueDate: dayKeyToDateOnly(day) } };
    }
    case "BOOLEAN": {
      const answer = typeof raw === "string" ? raw.trim() : raw;
      if (answer === "" || answer === null || answer === undefined) return { ok: true, value: null };
      if (answer !== true && answer !== false && answer !== "true" && answer !== "false") return bad("choose yes or no.");
      const yes = answer === true || answer === "true";
      return { ok: true, value: { value: yes, valueText: yes ? "Yes" : "No", valueNumber: null, valueDate: null } };
    }
    case "SELECT": {
      const choice = String(raw ?? "").trim();
      if (!choice) return { ok: true, value: null };
      if (!optionsOf(field.options).includes(choice) && choice !== current) return bad(`"${choice}" isn't one of the choices.`);
      return { ok: true, value: { value: choice, valueText: choice, valueNumber: null, valueDate: null } };
    }
    case "MULTISELECT": {
      const picked = parseOptions(Array.isArray(raw) ? raw : raw ? [String(raw)] : []);
      if (picked.length === 0) return { ok: true, value: null };
      const allowed = new Set([...optionsOf(field.options), ...optionsOf(current)]);
      const unknown = picked.find((p) => !allowed.has(p));
      if (unknown) return bad(`"${unknown}" isn't one of the choices.`);
      return { ok: true, value: { value: picked, valueText: picked.join(", "), valueNumber: null, valueDate: null } };
    }
  }
}

// A stored value as a person reads it. Dates may have been stored as a day
// ("2026-11-03") or a full timestamp; both read as that calendar day.
export function displayFieldValue(dataType: CustomFieldDataType, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  switch (dataType) {
    case "BOOLEAN":
      return value === true ? "Yes" : value === false ? "No" : "";
    case "DATE": {
      const day = String(value).slice(0, 10);
      return isDayKey(day) ? new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : String(value);
    }
    case "MULTISELECT":
      return optionsOf(value).join(", ");
    default:
      return String(value);
  }
}

// A stored value as the edit form's starting input.
export function inputFromValue(dataType: CustomFieldDataType, value: unknown): FieldInput {
  if (value === null || value === undefined) return dataType === "MULTISELECT" ? [] : "";
  if (dataType === "BOOLEAN") return value === true ? "true" : value === false ? "false" : "";
  if (dataType === "MULTISELECT") return optionsOf(value);
  if (dataType === "DATE") return String(value).slice(0, 10);
  return String(value);
}
