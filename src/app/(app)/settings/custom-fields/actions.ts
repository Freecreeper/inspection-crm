"use server";

import type { CustomFieldEntityType, Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import * as fields from "@/lib/customFields/service";
import type { FieldInput } from "@/lib/customFields/shared";

async function requireManager() {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "custom-field:manage");
  return session?.user?.id ?? null;
}

// A field change shows up on every record page of that kind.
const done = <T,>(r: fields.Result<T>) => {
  if (r.ok) revalidatePath("/", "layout");
  return r;
};

export async function createFieldAction(input: { entityType: string; label: string; dataType: string; options?: string; required?: boolean }) {
  return done(await fields.createFieldDefinition(await requireManager(), input));
}

export async function updateFieldAction(id: string, input: { label?: string; options?: string; required?: boolean }) {
  return done(await fields.updateFieldDefinition(await requireManager(), id, input));
}

export async function setFieldActiveAction(id: string, active: boolean) {
  return done(await fields.setFieldActive(await requireManager(), id, active));
}

export async function moveFieldAction(id: string, direction: -1 | 1) {
  return done(await fields.moveField(await requireManager(), id, direction === -1 ? -1 : 1));
}

export async function deleteFieldAction(id: string) {
  return done(await fields.deleteFieldDefinition(await requireManager(), id));
}

const RECORD_PATH: Partial<Record<CustomFieldEntityType, (id: string) => string>> = {
  CUSTOMER: (id) => `/customers/${id}`,
  TRANSACTION: (id) => `/transactions/${id}`,
  INSPECTION: (id) => `/inspections/${id}`,
};

// Filling in a record's fields: allowed for whoever can edit that record.
export async function saveRecordFieldsAction(entityType: string, entityId: string, input: Record<string, FieldInput>): Promise<fields.Result> {
  const session = await auth();
  const type = entityType as CustomFieldEntityType;
  if (!fields.canEditCustomFields(session?.user?.role as Role | undefined, type)) return { ok: false, error: "You don't have permission to change these fields." };
  const result = await fields.saveRecordFields(session?.user?.id ?? null, type, entityId, input);
  if (result.ok) {
    const path = RECORD_PATH[type];
    // A property's fields show on its transactions and inspections.
    if (path) revalidatePath(path(entityId));
    else revalidatePath("/", "layout");
  }
  return result;
}
