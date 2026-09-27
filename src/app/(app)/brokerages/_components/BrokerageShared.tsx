"use client";

import { useRouter } from "next/navigation";
import { Mail, Phone } from "lucide-react";
import { InlineField } from "@/components/InlineField";
import { formatPhone } from "@/lib/phone";
import { telHref } from "@/lib/realtors/display";
import { MoreMenu } from "../../realtors/_components/MoreMenu";
import { updateBrokerageField, type BrokerageField } from "../actions";

const actionClass =
  "inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600";
const unavailableClass = "inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-200 px-3 py-1.5 text-sm text-slate-400";

// Shared by the preview drawer and the full record. Missing contact info
// removes only the action that needs it.
export function BrokerageQuickActions({
  brokerageId,
  phone,
  email,
  showOpenRecord = false,
}: {
  brokerageId: string;
  phone: string | null;
  email: string | null;
  showOpenRecord?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {phone ? (
        <a href={telHref(phone)} className={actionClass}>
          <Phone className="h-4 w-4" aria-hidden="true" />
          Call
        </a>
      ) : (
        <span className={unavailableClass}>
          <Phone className="h-4 w-4" aria-hidden="true" />
          Phone not provided
        </span>
      )}
      {email ? (
        <a href={`mailto:${email}`} className={actionClass}>
          <Mail className="h-4 w-4" aria-hidden="true" />
          Email
        </a>
      ) : (
        <span className={unavailableClass}>
          <Mail className="h-4 w-4" aria-hidden="true" />
          Email not provided
        </span>
      )}
      <MoreMenu
        buttonClassName={actionClass}
        items={[
          ...(showOpenRecord ? [{ label: "Open full record", href: `/brokerages/${brokerageId}` }] : []),
          { label: "View realtors", href: `/brokerages/${brokerageId}?tab=realtors` },
          { label: "View transactions", href: `/brokerages/${brokerageId}?tab=transactions` },
        ]}
      />
    </div>
  );
}

export interface BrokerageContactValues {
  name: string;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

// Each field edits and saves on its own through updateBrokerageField, which
// validates, enforces crm:write, and audits the change server-side. With no
// onSaved, the route is refreshed (the server-rendered record).
export function BrokerageContactFields({
  brokerageId,
  values,
  canEdit,
  includeName = false,
  onSaved,
}: {
  brokerageId: string;
  values: BrokerageContactValues;
  canEdit: boolean;
  includeName?: boolean;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const saver = (field: BrokerageField) => async (value: string) => {
    const result = await updateBrokerageField(brokerageId, field, value);
    if (result.ok) (onSaved ?? router.refresh)();
    return result;
  };
  const text = (label: string, field: BrokerageField) => <InlineField label={label} value={values[field] ?? ""} canEdit={canEdit} onSave={saver(field)} />;

  return (
    <div className="space-y-3">
      {includeName && text("Brokerage name", "name")}
      <InlineField
        label="Phone"
        editor="tel"
        value={values.phone ? formatPhone(values.phone) : ""}
        display={values.phone ? formatPhone(values.phone) : undefined}
        formatInput={formatPhone}
        canEdit={canEdit}
        onSave={saver("phone")}
      />
      <InlineField label="Email" editor="email" value={values.email ?? ""} canEdit={canEdit} onSave={saver("email")} />
      {text("Street address", "addressLine1")}
      {text("City", "city")}
      <div className="grid grid-cols-2 gap-3">
        {text("State", "state")}
        {text("ZIP", "zip")}
      </div>
    </div>
  );
}
