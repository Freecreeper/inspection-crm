"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Drawer } from "@/components/Drawer";
import { formatShortDate } from "@/lib/dates";
import { brokerageLabel, formatCurrency } from "@/lib/realtors/display";
import type { RealtorPreview } from "@/lib/realtors/preview";
import { getRealtorPreview } from "../actions";
import { StatusBadge } from "./StatusBadge";
import { QuickActions } from "./QuickActions";
import { TaskActions } from "./TaskActions";
import { ProfileFields } from "./ProfileFields";

type LoadState = { status: "loading" } | { status: "ready"; preview: RealtorPreview } | { status: "missing" } | { status: "error" };

// The bridge between browsing and acting: opened by selecting a directory
// row, it fetches that one realtor's preview on demand (the directory
// itself never loads this depth of data). A response for a realtor that's
// no longer selected is ignored, so fast clicking can't show stale data.
export function RealtorPreviewDrawer({
  realtorId,
  onClose,
  onChanged,
}: {
  realtorId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const requestRef = useRef(0);

  const load = useCallback(async (id: string, showSpinner: boolean) => {
    const request = ++requestRef.current;
    if (showSpinner) setState({ status: "loading" });
    try {
      const preview = await getRealtorPreview(id);
      if (request !== requestRef.current) return;
      setState(preview ? { status: "ready", preview } : { status: "missing" });
    } catch {
      if (request === requestRef.current) setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-select; load() sets state after an await
    if (realtorId) load(realtorId, true);
  }, [realtorId, load]);

  const refresh = useCallback(() => {
    if (realtorId) load(realtorId, false);
    onChanged();
  }, [realtorId, load, onChanged]);

  const title =
    state.status === "ready" ? state.preview.displayName : state.status === "loading" ? "Loading…" : "Realtor";

  return (
    <Drawer open={realtorId !== null} onClose={onClose} title={title} titleId="realtor-preview-title" focusKey={realtorId}>
      {state.status === "loading" && <DrawerSkeleton />}
      {state.status === "missing" && <p className="p-5 text-sm text-slate-500">This realtor no longer exists or has been archived.</p>}
      {state.status === "error" && <p className="p-5 text-sm text-red-600">Couldn&apos;t load this realtor. Try again.</p>}
      {state.status === "ready" && <PreviewBody preview={state.preview} onChanged={refresh} />}
    </Drawer>
  );
}

function PreviewBody({ preview, onChanged }: { preview: RealtorPreview; onChanged: () => void }) {
  const { metrics, permissions } = preview;
  return (
    <div className="divide-y divide-slate-100">
      <section className="space-y-3 px-5 py-4" aria-label="Summary">
        <div className="text-sm text-slate-600">
          {preview.legalName && <p className="text-xs text-slate-500">Legal name: {preview.legalName}</p>}
          {preview.brokerage ? (
            <Link href={`/brokerages/${preview.brokerage.id}`} className="hover:text-slate-900 hover:underline">
              {brokerageLabel(preview.brokerage)}
            </Link>
          ) : (
            <span className="text-slate-400">No brokerage on file</span>
          )}
          <div className="mt-1.5">
            <StatusBadge active={preview.active} />
          </div>
        </div>
        <QuickActions realtorId={preview.id} phone={preview.phone} email={preview.email} canWrite={permissions.canWrite} showOpenRecord onChanged={onChanged} />
      </section>

      <section className="px-5 py-4" aria-label="Relationship at a glance">
        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Transactions" value={String(metrics.associatedTransactions)} />
          <Stat label="Referrals" value={String(metrics.referrals)} />
          {permissions.canViewFinancials && <Stat label="Associated revenue" value={formatCurrency(metrics.associatedRevenue)} />}
        </dl>
        {permissions.canViewFinancials && (
          <p className="mt-2 text-xs text-slate-500">
            Associated revenue is billed on deals they were part of — not revenue they referred. See Referrals for that.
          </p>
        )}
      </section>

      <section className="px-5 py-4" aria-labelledby="drawer-contact">
        <h3 id="drawer-contact" className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
          Contact
        </h3>
        <ProfileFields
          realtorId={preview.id}
          values={preview}
          fields={["phone", "email", "preferredContactMethod"]}
          canEdit={permissions.canWrite}
          onSaved={onChanged}
        />
      </section>

      <section className="px-5 py-4" aria-labelledby="drawer-next">
        <h3 id="drawer-next" className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Next action
        </h3>
        {preview.nextAction ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-900">
              {preview.nextAction.title}
              <span className="text-slate-500"> — {preview.nextAction.dueAt ? formatShortDate(preview.nextAction.dueAt) : "no due date"}</span>
            </p>
            {permissions.canWrite && <TaskActions taskId={preview.nextAction.id} dueAt={preview.nextAction.dueAt} onDone={onChanged} />}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No upcoming follow-up.</p>
        )}
      </section>

      <section className="px-5 py-4" aria-labelledby="drawer-activity">
        <h3 id="drawer-activity" className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Recent activity
        </h3>
        {preview.recentActivity.length > 0 ? (
          <ol className="space-y-2.5">
            {preview.recentActivity.map((item) => (
              <li key={item.id} className="flex justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="text-slate-900">{item.title}</p>
                  {item.detail && <p className="truncate text-xs text-slate-500">{item.detail}</p>}
                </div>
                <time dateTime={item.at} className="shrink-0 text-xs tabular-nums text-slate-500">
                  {formatShortDate(item.at)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-500">No activity recorded yet.</p>
        )}
      </section>

      <div className="px-5 py-4">
        <Link
          href={`/realtors/${preview.id}`}
          className="block w-full rounded-md bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white hover:bg-slate-800"
        >
          Open full realtor record
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-4 p-5" aria-hidden="true">
      <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      <div className="h-8 w-full animate-pulse rounded bg-slate-100" />
      <div className="h-16 w-full animate-pulse rounded bg-slate-100" />
      <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
    </div>
  );
}
