"use client";

import { useRouter } from "next/navigation";
import { InlineField } from "@/components/InlineField";
import { formatPhone } from "@/lib/phone";
import { updateCustomerContact } from "./actions";

export function CustomerContactFields({ customerId, email, phone, canEdit }: { customerId: string; email: string | null; phone: string | null; canEdit: boolean }) {
  const router = useRouter();
  const save = (field: "email" | "phone") => async (value: string) => {
    try {
      const result = await updateCustomerContact(customerId, field, value);
      if (result.ok) router.refresh();
      return result;
    } catch {
      return { ok: false as const, error: "You may not have permission to edit customers." };
    }
  };
  return (
    <dl className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <InlineField label="Email" editor="email" value={email ?? ""} emptyText="Not provided" canEdit={canEdit} onSave={save("email")} />
      <InlineField label="Phone" editor="tel" value={formatPhone(phone)} formatInput={formatPhone} canEdit={canEdit} onSave={save("phone")} />
    </dl>
  );
}
