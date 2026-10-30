import type { CustomFieldDataType, CustomFieldEntityType, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { can } from "@/lib/rbac";
import {
  CUSTOM_FIELD_ENTITIES,
  DATA_TYPES,
  EDITABLE_ENTITY_TYPES,
  MAX_LABEL,
  MAX_OPTION_LENGTH,
  MAX_OPTIONS,
  displayFieldValue,
  fieldKeyFromLabel,
  hasOptions,
  inputFromValue,
  optionsOf,
  parseFieldValue,
  parseOptions,
  type FieldInput,
} from "./shared";

// Custom fields (§ custom fields): owners define extra fields per kind of
// record; staff fill them in on that record's page. A field's kind of
// record, data type and stored key are fixed once created — changing them
// would silently reinterpret values already saved — so a different field
// is made instead. Every change is recorded in the activity log.

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const fail = (error: string): Result<never> => ({ ok: false, error });

function checkLabel(raw: unknown): string | Result<never> {
  const label = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!label) return fail("Give the field a name.");
  if (label.length > MAX_LABEL) return fail(`Keep the name under ${MAX_LABEL} characters.`);
  return label;
}

function checkOptions(dataType: CustomFieldDataType, raw: unknown): string[] | null | Result<never> {
  if (!hasOptions(dataType)) return null;
  const options = parseOptions(raw);
  if (options.length === 0) return fail("List at least one choice.");
  if (options.length > MAX_OPTIONS) return fail(`A field can have at most ${MAX_OPTIONS} choices.`);
  if (options.some((o) => o.length > MAX_OPTION_LENGTH)) return fail(`Keep each choice under ${MAX_OPTION_LENGTH} characters.`);
  return options;
}

const isFailure = (v: unknown): v is Result<never> => typeof v === "object" && v !== null && "ok" in v;

// ---------------------------------------------------------------- definitions

export async function listFieldDefinitions() {
  const [defs, counts] = await Promise.all([
    prisma.customFieldDefinition.findMany({ orderBy: [{ entityType: "asc" }, { displayOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.customFieldValue.groupBy({ by: ["fieldDefinitionId"], _count: { _all: true } }),
  ]);
  const used = new Map(counts.map((c) => [c.fieldDefinitionId, c._count._all]));
  return defs.map((d) => ({ ...d, options: optionsOf(d.options), valueCount: used.get(d.id) ?? 0 }));
}

export async function createFieldDefinition(
  actorId: string | null,
  input: { entityType: unknown; label: unknown; dataType: unknown; options?: unknown; required?: unknown }
): Promise<Result<{ id: string }>> {
  const entityType = input.entityType as CustomFieldEntityType;
  if (!EDITABLE_ENTITY_TYPES.includes(entityType)) return fail("Pick which kind of record the field is for.");
  const dataType = input.dataType as CustomFieldDataType;
  if (!DATA_TYPES.includes(dataType)) return fail("Pick a type for the field.");
  const label = checkLabel(input.label);
  if (isFailure(label)) return label;
  const options = checkOptions(dataType, input.options);
  if (isFailure(options)) return options;

  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`custom-field-definitions:${entityType}`}))`;
    const siblings = await tx.customFieldDefinition.findMany({ where: { entityType }, select: { fieldKey: true, label: true, displayOrder: true } });
    if (siblings.some((s) => s.label.toLowerCase() === label.toLowerCase())) return null;
    const base = fieldKeyFromLabel(label);
    const taken = new Set(siblings.map((s) => s.fieldKey));
    let fieldKey = base;
    for (let n = 2; taken.has(fieldKey); n++) fieldKey = `${base}_${n}`;
    const row = await tx.customFieldDefinition.create({
      data: {
        entityType,
        fieldKey,
        label,
        dataType,
        options: options ?? undefined,
        required: input.required === true,
        displayOrder: siblings.reduce((max, s) => Math.max(max, s.displayOrder + 1), 0),
      },
      select: { id: true },
    });
    await logActivity(tx, { actorId, action: "custom_field.created", entityType: "CustomFieldDefinition", entityId: row.id, after: { entityType, fieldKey, label, dataType, options, required: input.required === true } });
    return row;
  });
  if (!created) return fail(`There's already a ${singular(entityType)} field called "${label}".`);
  return { ok: true, data: created };
}

export async function updateFieldDefinition(actorId: string | null, id: string, input: { label?: unknown; options?: unknown; required?: unknown }): Promise<Result> {
  const def = await prisma.customFieldDefinition.findUnique({ where: { id } });
  if (!def) return fail("That field no longer exists.");
  const label = input.label === undefined ? def.label : checkLabel(input.label);
  if (isFailure(label)) return label;
  const options = input.options === undefined ? (hasOptions(def.dataType) ? optionsOf(def.options) : null) : checkOptions(def.dataType, input.options);
  if (isFailure(options)) return options;
  const required = input.required === undefined ? def.required : input.required === true;

  if (label.toLowerCase() !== def.label.toLowerCase()) {
    const clash = await prisma.customFieldDefinition.findFirst({ where: { entityType: def.entityType, id: { not: id }, label: { equals: label, mode: "insensitive" } }, select: { id: true } });
    if (clash) return fail(`There's already a ${singular(def.entityType)} field called "${label}".`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.customFieldDefinition.update({ where: { id }, data: { label, options: options ?? undefined, required } });
    await logActivity(tx, {
      actorId,
      action: "custom_field.updated",
      entityType: "CustomFieldDefinition",
      entityId: id,
      before: { label: def.label, options: optionsOf(def.options), required: def.required },
      after: { label, options, required },
    });
  });
  return { ok: true, data: undefined };
}

// Turning a field off hides it everywhere but keeps every value saved in it.
export async function setFieldActive(actorId: string | null, id: string, active: boolean): Promise<Result> {
  const def = await prisma.customFieldDefinition.findUnique({ where: { id }, select: { active: true } });
  if (!def) return fail("That field no longer exists.");
  if (def.active === active) return { ok: true, data: undefined };
  await prisma.$transaction(async (tx) => {
    await tx.customFieldDefinition.update({ where: { id }, data: { active } });
    await logActivity(tx, { actorId, action: active ? "custom_field.reactivated" : "custom_field.deactivated", entityType: "CustomFieldDefinition", entityId: id });
  });
  return { ok: true, data: undefined };
}

// Swaps a field with its neighbor; also renumbers that kind's fields 0..n so
// gaps or ties left by older data can't make a move do nothing.
export async function moveField(actorId: string | null, id: string, direction: -1 | 1): Promise<Result> {
  const def = await prisma.customFieldDefinition.findUnique({ where: { id }, select: { entityType: true } });
  if (!def) return fail("That field no longer exists.");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`custom-field-definitions:${def.entityType}`}))`;
    const ordered = await tx.customFieldDefinition.findMany({ where: { entityType: def.entityType }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], select: { id: true } });
    const from = ordered.findIndex((d) => d.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    for (const [i, d] of ordered.entries()) await tx.customFieldDefinition.update({ where: { id: d.id }, data: { displayOrder: i } });
    await logActivity(tx, { actorId, action: "custom_field.reordered", entityType: "CustomFieldDefinition", entityId: id, after: { position: to + 1 } });
  });
  return { ok: true, data: undefined };
}

// Only a field nothing has been saved in can be deleted; otherwise it's
// turned off, so no one's data disappears.
export async function deleteFieldDefinition(actorId: string | null, id: string): Promise<Result> {
  const def = await prisma.customFieldDefinition.findUnique({ where: { id } });
  if (!def) return { ok: true, data: undefined };
  const result = await prisma.$transaction(async (tx) => {
    const used = await tx.customFieldValue.count({ where: { fieldDefinitionId: id } });
    if (used > 0) return used;
    await tx.customFieldDefinition.delete({ where: { id } });
    await logActivity(tx, { actorId, action: "custom_field.deleted", entityType: "CustomFieldDefinition", entityId: id, before: { entityType: def.entityType, fieldKey: def.fieldKey, label: def.label, dataType: def.dataType } });
    return 0;
  });
  if (result > 0) return fail(`"${def.label}" is filled in on ${result} record${result === 1 ? "" : "s"}, so it can't be deleted. Turn it off instead to hide it and keep that data.`);
  return { ok: true, data: undefined };
}

// --------------------------------------------------------------------- values

// Who may fill in fields on each kind of record — the same people who can
// edit that record. Inspectors fill in inspection fields on site.
export function canEditCustomFields(role: Role | undefined, entityType: CustomFieldEntityType): boolean {
  if (entityType === "INSPECTION") return can(role, "crm:write") || can(role, "inspection:conduct");
  if (entityType === "PROPERTY" || entityType === "CUSTOMER" || entityType === "TRANSACTION") return can(role, "crm:write");
  return can(role, "inspection:conduct");
}

export interface RecordField {
  id: string;
  label: string;
  dataType: CustomFieldDataType;
  options: string[];
  required: boolean;
  display: string;
  input: FieldInput;
}

export async function loadRecordFields(entityType: CustomFieldEntityType, entityId: string): Promise<RecordField[]> {
  const defs = await prisma.customFieldDefinition.findMany({
    where: { entityType, active: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    include: { values: { where: { entityType, entityId }, take: 1 } },
  });
  return defs.map((d) => {
    const value = d.values[0]?.value ?? null;
    return { id: d.id, label: d.label, dataType: d.dataType, options: optionsOf(d.options), required: d.required, display: displayFieldValue(d.dataType, value), input: inputFromValue(d.dataType, value) };
  });
}

async function recordExists(entityType: CustomFieldEntityType, id: string): Promise<boolean> {
  const where = { where: { id }, select: { id: true } } as const;
  switch (entityType) {
    case "PROPERTY":
      return Boolean(await prisma.property.findUnique(where));
    case "CUSTOMER":
      return Boolean(await prisma.customer.findUnique(where));
    case "TRANSACTION":
      return Boolean(await prisma.transaction.findUnique(where));
    case "INSPECTION":
      return Boolean(await prisma.inspection.findUnique(where));
    case "REPORT":
      return Boolean(await prisma.inspectionReport.findUnique(where));
    case "REPORT_SECTION":
      return Boolean(await prisma.reportSection.findUnique(where));
    case "REPORT_COMPONENT":
      return Boolean(await prisma.reportComponent.findUnique(where));
    case "FINDING":
      return Boolean(await prisma.finding.findUnique(where));
  }
}

// Saves a record's whole custom-field form: every active field of that kind,
// validated together (nothing is saved if any is wrong). An emptied field's
// value is removed rather than stored blank.
export async function saveRecordFields(actorId: string | null, entityType: CustomFieldEntityType, entityId: string, input: Record<string, FieldInput>): Promise<Result> {
  if (!CUSTOM_FIELD_ENTITIES.some((e) => e.type === entityType)) return fail("Unknown kind of record.");
  if (!(await recordExists(entityType, entityId))) return fail("That record no longer exists.");

  const defs = await prisma.customFieldDefinition.findMany({ where: { entityType, active: true }, include: { values: { where: { entityType, entityId }, take: 1 } } });
  const fieldErrors: Record<string, string> = {};
  const changes: { def: (typeof defs)[number]; parsed: ReturnType<typeof parseFieldValue> & { ok: true } }[] = [];
  for (const def of defs) {
    if (!(def.id in input)) continue;
    const current = def.values[0]?.value;
    const parsed = parseFieldValue(def, input[def.id], current);
    if (!parsed.ok) fieldErrors[def.id] = parsed.error;
    else if (def.required && parsed.value === null) fieldErrors[def.id] = `${def.label} is required.`;
    else changes.push({ def, parsed });
  }
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors).join(" "), fieldErrors };

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  await prisma.$transaction(async (tx) => {
    for (const { def, parsed } of changes) {
      const current = def.values[0]?.value ?? null;
      const next = parsed.value?.value ?? null;
      if (JSON.stringify(current) === JSON.stringify(next)) continue;
      before[def.fieldKey] = current;
      after[def.fieldKey] = next;
      const key = { fieldDefinitionId_entityType_entityId: { fieldDefinitionId: def.id, entityType, entityId } };
      if (!parsed.value) {
        await tx.customFieldValue.deleteMany({ where: { fieldDefinitionId: def.id, entityType, entityId } });
        continue;
      }
      const data = { value: parsed.value.value as Prisma.InputJsonValue, valueText: parsed.value.valueText, valueNumber: parsed.value.valueNumber, valueDate: parsed.value.valueDate };
      await tx.customFieldValue.upsert({ where: key, update: data, create: { fieldDefinitionId: def.id, entityType, entityId, ...data } });
    }
    if (Object.keys(after).length) {
      await logActivity(tx, { actorId, action: "custom_fields.updated", entityType: entityLogName(entityType), entityId, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue });
    }
  });
  return { ok: true, data: undefined };
}

function singular(entityType: CustomFieldEntityType): string {
  return CUSTOM_FIELD_ENTITIES.find((e) => e.type === entityType)?.singular ?? "record";
}

// The activity log's usual entity names ("Customer", "Inspection", …).
function entityLogName(entityType: CustomFieldEntityType): string {
  return entityType
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("")
    .replace(/^Report$/, "InspectionReport");
}
