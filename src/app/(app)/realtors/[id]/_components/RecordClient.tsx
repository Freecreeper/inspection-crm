"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BrokerageCombobox } from "../../BrokerageCombobox";
import { Combobox } from "@/components/Combobox";
import { QuickActions } from "../../_components/QuickActions";
import { ProfileFields, type ProfileValues } from "../../_components/ProfileFields";
import { TaskActions } from "../../_components/TaskActions";
import { changeRealtorBrokerageInline, createReferralSourceForRealtor, linkReferralSourceToRealtor } from "../../actions";

// Thin client wrappers for the server-rendered record: each performs its
// action and then refreshes the route so every tab reflects the change.

export function RecordQuickActions(props: { realtorId: string; phone: string | null; email: string | null; canWrite: boolean }) {
  const router = useRouter();
  return <QuickActions {...props} onChanged={() => router.refresh()} />;
}

export function RecordProfileFields(props: {
  realtorId: string;
  values: ProfileValues;
  fields: ("firstName" | "lastName" | "preferredName" | "phone" | "email" | "preferredContactMethod" | "notes" | "active")[];
  canEdit: boolean;
}) {
  const router = useRouter();
  return <ProfileFields {...props} onSaved={() => router.refresh()} />;
}

export function RecordTaskActions({ taskId, dueAt }: { taskId: string; dueAt: string | null }) {
  const router = useRouter();
  return <TaskActions taskId={taskId} dueAt={dueAt} size="xs" onDone={() => router.refresh()} />;
}

// Changing brokerage closes the current history row and opens a new one
// (see moveRealtorToBrokerage) — past transactions keep their snapshot.
export function BrokerageEditor({ options, realtorId, hasBrokerage }: { options: { id: string; label: string }[]; realtorId: string; hasBrokerage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="text-sm font-medium text-emerald-700 hover:underline">
        {hasBrokerage ? "Change brokerage" : "Set brokerage"}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <BrokerageCombobox
        name="brokerageId"
        options={options}
        onSelect={(option) => {
          if (!option) return;
          setError(null);
          startTransition(async () => {
            try {
              const result = await changeRealtorBrokerageInline(realtorId, option.id);
              if (!result.ok) return setError(result.error);
              setEditing(false);
              router.refresh();
            } catch {
              setError("Couldn't change the brokerage. You may not have permission.");
            }
          });
        }}
      />
      <p className="text-xs text-slate-500">Past transactions keep the brokerage they had at the time.</p>
      {pending && <p className="text-xs text-slate-500">Saving…</p>}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500 hover:underline">
        Cancel
      </button>
    </div>
  );
}

export function ReferralSourceLinker({ realtorId, unlinkedSources }: { realtorId: string; unlinkedSources: { id: string; label: string; sublabel?: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) return setError(result.error);
        router.refresh();
      } catch {
        setError("Couldn't link the referral source. You may not have permission.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => createReferralSourceForRealtor(realtorId).then((r) => (r.ok ? { ok: true as const } : r)))}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        Create a referral source for this realtor
      </button>
      {unlinkedSources.length > 0 && (
        <div>
          <p className="text-xs text-slate-500">Or link an existing, unlinked referral source:</p>
          <div className="mt-1 max-w-sm">
            <Combobox
              name="referralSourceId"
              placeholder="Search referral sources…"
              options={unlinkedSources}
              onSelect={(option) => {
                if (option) run(() => linkReferralSourceToRealtor(realtorId, option.id).then((r) => (r.ok ? { ok: true as const } : r)));
              }}
            />
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
