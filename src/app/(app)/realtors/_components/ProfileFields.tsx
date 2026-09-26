"use client";

import { InlineField, type SaveResult } from "@/components/InlineField";
import { formatPhone } from "@/lib/phone";
import { CONTACT_METHOD_LABELS } from "@/lib/realtors/display";
import { updateRealtorProfile, type RealtorProfilePatch } from "../actions";

export interface ProfileValues {
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  preferredContactMethod: string | null;
  notes: string | null;
  active: boolean;
}

type FieldKey = "firstName" | "lastName" | "preferredName" | "phone" | "email" | "preferredContactMethod" | "notes" | "active";

const CONTACT_METHOD_OPTIONS = [
  { value: "", label: "No preference" },
  ...Object.entries(CONTACT_METHOD_LABELS).map(([value, label]) => ({ value, label })),
];

// Each field edits and saves on its own through updateRealtorProfile, which
// validates, enforces crm:write, and audits the change server-side.
export function ProfileFields({
  realtorId,
  values,
  fields,
  canEdit,
  onSaved,
}: {
  realtorId: string;
  values: ProfileValues;
  fields: FieldKey[];
  canEdit: boolean;
  onSaved?: () => void;
}) {
  function saver(build: (value: string) => RealtorProfilePatch) {
    return async (value: string): Promise<SaveResult> => {
      try {
        const result = await updateRealtorProfile(realtorId, build(value));
        if (!result.ok) return result;
        onSaved?.();
        return { ok: true };
      } catch {
        return { ok: false, error: "Couldn't save. You may not have permission to edit realtors." };
      }
    };
  }

  const render: Record<FieldKey, React.ReactNode> = {
    firstName: <InlineField key="firstName" label="First name" value={values.firstName} canEdit={canEdit} onSave={saver((v) => ({ firstName: v }))} />,
    lastName: <InlineField key="lastName" label="Last name" value={values.lastName} canEdit={canEdit} onSave={saver((v) => ({ lastName: v }))} />,
    preferredName: (
      <InlineField key="preferredName" label="Preferred name" value={values.preferredName ?? ""} emptyText="None" canEdit={canEdit} onSave={saver((v) => ({ preferredName: v }))} />
    ),
    phone: (
      <InlineField
        key="phone"
        label="Phone"
        editor="tel"
        value={formatPhone(values.phone)}
        formatInput={formatPhone}
        canEdit={canEdit}
        onSave={saver((v) => ({ phone: v }))}
      />
    ),
    email: <InlineField key="email" label="Email" editor="email" value={values.email ?? ""} canEdit={canEdit} onSave={saver((v) => ({ email: v }))} />,
    preferredContactMethod: (
      <InlineField
        key="preferredContactMethod"
        label="Preferred contact method"
        editor="select"
        options={CONTACT_METHOD_OPTIONS}
        value={values.preferredContactMethod ?? ""}
        display={values.preferredContactMethod ? CONTACT_METHOD_LABELS[values.preferredContactMethod as keyof typeof CONTACT_METHOD_LABELS] : undefined}
        emptyText="No preference"
        canEdit={canEdit}
        onSave={saver((v) => ({ preferredContactMethod: v || null }))}
      />
    ),
    notes: (
      <InlineField
        key="notes"
        label="Notes"
        editor="textarea"
        value={values.notes ?? ""}
        display={<span className="whitespace-pre-line">{values.notes}</span>}
        emptyText="No notes yet"
        canEdit={canEdit}
        onSave={saver((v) => ({ notes: v }))}
      />
    ),
    active: (
      <InlineField
        key="active"
        label="Status"
        editor="select"
        options={[
          { value: "true", label: "Active" },
          { value: "false", label: "Inactive" },
        ]}
        value={String(values.active)}
        display={values.active ? "Active" : "Inactive"}
        canEdit={canEdit}
        onSave={saver((v) => ({ active: v === "true" }))}
      />
    ),
  };

  return <dl className="space-y-3">{fields.map((f) => render[f])}</dl>;
}
