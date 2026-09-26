"use client";

import { useState } from "react";
import { Mail, Phone, Plus } from "lucide-react";
import { telHref } from "@/lib/realtors/display";
import { LogCommunicationForm, QuickTaskForm } from "./QuickForms";
import { MoreMenu } from "./MoreMenu";

const actionClass =
  "inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600";
const unavailableClass = "inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-200 px-3 py-1.5 text-sm text-slate-400";

// Missing contact info removes only the action that needs it — the rest of
// the record stays fully usable (§7 non-blocking data).
export function QuickActions({
  realtorId,
  phone,
  email,
  canWrite,
  showOpenRecord = false,
  onChanged,
  onCustomize,
}: {
  realtorId: string;
  phone: string | null;
  email: string | null;
  canWrite: boolean;
  showOpenRecord?: boolean;
  onChanged: () => void;
  // Present only where the card is customizable (the preview drawer).
  onCustomize?: () => void;
}) {
  const [panel, setPanel] = useState<"task" | "log" | null>(null);

  return (
    <div className="space-y-3">
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
        {canWrite && (
          <button type="button" onClick={() => setPanel(panel === "task" ? null : "task")} aria-expanded={panel === "task"} className={actionClass}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Task
          </button>
        )}
        <MoreMenu
          buttonClassName={actionClass}
          items={[
            ...(canWrite ? [{ label: "Log call or email", onSelect: () => setPanel("log") }] : []),
            ...(canWrite ? [{ label: "New transaction", href: `/transactions/new?realtorId=${realtorId}` }] : []),
            ...(showOpenRecord ? [{ label: "Open full record", href: `/realtors/${realtorId}` }] : []),
            { label: "Relationship analytics", href: `/realtors/${realtorId}/analytics` },
            ...(onCustomize ? [{ label: "Customize card", onSelect: onCustomize }] : []),
          ]}
        />
      </div>
      {panel === "task" && (
        <QuickTaskForm
          realtorId={realtorId}
          onCancel={() => setPanel(null)}
          onDone={() => {
            setPanel(null);
            onChanged();
          }}
        />
      )}
      {panel === "log" && (
        <LogCommunicationForm
          realtorId={realtorId}
          onCancel={() => setPanel(null)}
          onDone={() => {
            setPanel(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
