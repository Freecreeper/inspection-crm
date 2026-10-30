import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { canEditCustomFields, createFieldDefinition, deleteFieldDefinition, saveRecordFields, updateFieldDefinition } from "./service";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>> & { $executeRaw: Fn };

const def = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  entityType: "PROPERTY",
  fieldKey: "foundation_type",
  label: "Foundation type",
  dataType: "SELECT",
  options: ["Slab", "Crawlspace"],
  required: false,
  active: true,
  values: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.$executeRaw.mockResolvedValue(1);
  db.property.findUnique.mockResolvedValue({ id: "p1" });
});

describe("defining fields", () => {
  it("creates a field with a key from its name, at the end of its kind's list", async () => {
    db.customFieldDefinition.findMany.mockResolvedValue([{ fieldKey: "foundation_type", label: "Old foundation", displayOrder: 3 }]);
    db.customFieldDefinition.create.mockResolvedValue({ id: "new" });
    expect(await createFieldDefinition("u1", { entityType: "PROPERTY", label: "Foundation  type", dataType: "SELECT", options: "Slab\nBasement", required: true })).toEqual({ ok: true, data: { id: "new" } });
    expect(db.customFieldDefinition.create).toHaveBeenCalledWith({
      data: { entityType: "PROPERTY", fieldKey: "foundation_type_2", label: "Foundation type", dataType: "SELECT", options: ["Slab", "Basement"], required: true, displayOrder: 4 },
      select: { id: true },
    });
    expect(db.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "custom_field.created" }) });
  });

  it("refuses a duplicate name, a pick-list with no choices, and kinds with no screen yet", async () => {
    db.customFieldDefinition.findMany.mockResolvedValue([{ fieldKey: "gate_code", label: "Gate code", displayOrder: 0 }]);
    expect(await createFieldDefinition("u1", { entityType: "INSPECTION", label: "gate CODE", dataType: "TEXT" })).toMatchObject({ ok: false, error: expect.stringContaining("already") });
    expect(await createFieldDefinition("u1", { entityType: "PROPERTY", label: "Roof", dataType: "SELECT", options: " \n " })).toMatchObject({ ok: false });
    expect(await createFieldDefinition("u1", { entityType: "FINDING", label: "Cost", dataType: "NUMBER" })).toMatchObject({ ok: false });
    expect(await createFieldDefinition("u1", { entityType: "PROPERTY", label: "Roof", dataType: "COLOR" })).toMatchObject({ ok: false });
    expect(db.customFieldDefinition.create).not.toHaveBeenCalled();
  });

  it("edits the name, choices and required, but never the type or key", async () => {
    db.customFieldDefinition.findUnique.mockResolvedValue(def());
    db.customFieldDefinition.findFirst.mockResolvedValue(null);
    await updateFieldDefinition("u1", "f1", { label: "Foundation", options: "Slab\nBasement", required: true, dataType: "TEXT" } as never);
    expect(db.customFieldDefinition.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { label: "Foundation", options: ["Slab", "Basement"], required: true } });
  });

  it("deletes only a field nothing is saved in", async () => {
    db.customFieldDefinition.findUnique.mockResolvedValue(def());
    db.customFieldValue.count.mockResolvedValueOnce(3);
    expect(await deleteFieldDefinition("u1", "f1")).toMatchObject({ ok: false, error: expect.stringContaining("3 records") });
    expect(db.customFieldDefinition.delete).not.toHaveBeenCalled();
    db.customFieldValue.count.mockResolvedValueOnce(0);
    expect(await deleteFieldDefinition("u1", "f1")).toEqual({ ok: true, data: undefined });
    expect(db.customFieldDefinition.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
  });
});

describe("saving a record's fields", () => {
  it("saves a valid value and logs the change by field key", async () => {
    db.customFieldDefinition.findMany.mockResolvedValue([def()]);
    expect(await saveRecordFields("u1", "PROPERTY", "p1", { f1: "Slab" })).toEqual({ ok: true, data: undefined });
    expect(db.customFieldValue.upsert).toHaveBeenCalledWith({
      where: { fieldDefinitionId_entityType_entityId: { fieldDefinitionId: "f1", entityType: "PROPERTY", entityId: "p1" } },
      update: { value: "Slab", valueText: "Slab", valueNumber: null, valueDate: null },
      create: { fieldDefinitionId: "f1", entityType: "PROPERTY", entityId: "p1", value: "Slab", valueText: "Slab", valueNumber: null, valueDate: null },
    });
    expect(db.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "custom_fields.updated", entityType: "Property", entityId: "p1", after: { foundation_type: "Slab" } }) });
  });

  it("removes a value that was cleared", async () => {
    db.customFieldDefinition.findMany.mockResolvedValue([def({ values: [{ value: "Slab" }] })]);
    await saveRecordFields("u1", "PROPERTY", "p1", { f1: "" });
    expect(db.customFieldValue.deleteMany).toHaveBeenCalledWith({ where: { fieldDefinitionId: "f1", entityType: "PROPERTY", entityId: "p1" } });
    expect(db.customFieldValue.upsert).not.toHaveBeenCalled();
  });

  it("saves nothing when any field is wrong or a required one is empty", async () => {
    db.customFieldDefinition.findMany.mockResolvedValue([def(), def({ id: "f2", fieldKey: "year_roof", label: "Roof year", dataType: "NUMBER", options: null, required: true })]);
    const result = await saveRecordFields("u1", "PROPERTY", "p1", { f1: "Slab", f2: "" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { f2: "Roof year is required." } });
    expect(db.customFieldValue.upsert).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("doesn't touch or log a field whose value didn't change", async () => {
    db.customFieldDefinition.findMany.mockResolvedValue([def({ values: [{ value: "Slab" }] })]);
    await saveRecordFields("u1", "PROPERTY", "p1", { f1: "Slab" });
    expect(db.customFieldValue.upsert).not.toHaveBeenCalled();
    expect(db.activityLog.create).not.toHaveBeenCalled();
  });

  it("refuses a record that doesn't exist", async () => {
    db.property.findUnique.mockResolvedValue(null);
    expect(await saveRecordFields("u1", "PROPERTY", "missing", { f1: "Slab" })).toMatchObject({ ok: false });
  });
});

it("lets the people who edit a record fill in its fields; inspectors also fill in inspection fields", () => {
  expect(canEditCustomFields("OFFICE_STAFF", "CUSTOMER")).toBe(true);
  expect(canEditCustomFields("INSPECTOR", "CUSTOMER")).toBe(false);
  expect(canEditCustomFields("INSPECTOR", "INSPECTION")).toBe(true);
  expect(canEditCustomFields("REPORTING_ANALYST", "INSPECTION")).toBe(false);
  expect(canEditCustomFields(undefined, "PROPERTY")).toBe(false);
});
