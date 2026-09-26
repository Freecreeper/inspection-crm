"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Drawer } from "@/components/Drawer";
import { formatShortDate } from "@/lib/dates";
import { brokerageLabel, formatCurrency } from "@/lib/realtors/display";
import type { RealtorPreview } from "@/lib/realtors/preview";
import { DEFAULT_PREVIEW_SECTIONS, PREVIEW_SECTIONS, type PreviewSection } from "@/lib/realtors/previewLayout";
import { getRealtorPreview, saveRealtorPreviewSections } from "../actions";
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

  const reload = useCallback(() => {
    if (realtorId) load(realtorId, false);
  }, [realtorId, load]);

  const refresh = useCallback(() => {
    reload();
    onChanged();
  }, [reload, onChanged]);

  const title =
    state.status === "ready" ? state.preview.displayName : state.status === "loading" ? "Loading…" : "Realtor";

  return (
    <Drawer open={realtorId !== null} onClose={onClose} title={title} titleId="realtor-preview-title" focusKey={realtorId}>
      {state.status === "loading" && <DrawerSkeleton />}
      {state.status === "missing" && <p className="p-5 text-sm text-slate-500">This realtor no longer exists or has been archived.</p>}
      {state.status === "error" && <p className="p-5 text-sm text-red-600">Couldn&apos;t load this realtor. Try again.</p>}
      {state.status === "ready" && <PreviewBody preview={state.preview} onChanged={refresh} onLayoutSaved={reload} />}
    </Drawer>
  );
}

function PreviewBody({ preview, onChanged, onLayoutSaved }: { preview: RealtorPreview; onChanged: () => void; onLayoutSaved: () => void }) {
  const { metrics, permissions } = preview;
  const [customizing, setCustomizing] = useState(false);
  // Applied locally the moment a box is ticked; the saved copy comes back
  // with the next preview load.
  const [sections, setSections] = useState<PreviewSection[]>(preview.sections);
  const on = (s: PreviewSection) => sections.includes(s);

  const stats = [
    on("transactions") && metrics && { label: "Transactions", value: String(metrics.associatedTransactions) },
    on("referrals") && metrics && { label: "Referrals", value: String(metrics.referrals) },
    on("revenue") && permissions.canViewFinancials && metrics?.associatedRevenue != null && {
      label: "Associated revenue",
      value: formatCurrency(metrics.associatedRevenue),
    },
  ].filter(Boolean) as { label: string; value: string }[];
  const showsRevenue = stats.some((s) => s.label === "Associated revenue");

  return (
    <div className="divide-y divide-slate-100">
      <section className="space-y-3 px-5 py-4" aria-label="Summary">
        {(preview.legalName || on("brokerage")) && (
          <div className="text-sm text-slate-600">
            {preview.legalName && <p className="text-xs text-slate-500">Legal name: {preview.legalName}</p>}
            {on("brokerage") &&
              (preview.brokerage ? (
                <Link href={`/brokerages/${preview.brokerage.id}`} className="hover:text-slate-900 hover:underline">
                  {brokerageLabel(preview.brokerage)}
                </Link>
              ) : (
                <span className="text-slate-400">No brokerage on file</span>
              ))}
          </div>
        )}

        {on("nextAction") && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Next action</h3>
            {preview.nextAction ? (
              <div className="mt-1 space-y-2">
                <p className="text-sm text-slate-900">
                  {preview.nextAction.title}
                  <span className="text-slate-500"> — {preview.nextAction.dueAt ? formatShortDate(preview.nextAction.dueAt) : "no due date"}</span>
                </p>
                {permissions.canWrite && <TaskActions taskId={preview.nextAction.id} dueAt={preview.nextAction.dueAt} size="xs" onDone={onChanged} />}
              </div>
            ) : (
              <p className="mt-1 text-sm text-slate-500">No upcoming follow-up.</p>
            )}
          </div>
        )}

        <QuickActions
          realtorId={preview.id}
          phone={preview.phone}
          email={preview.email}
          canWrite={permissions.canWrite}
          showOpenRecord
          onChanged={onChanged}
          onCustomize={() => setCustomizing(true)}
        />

        {customizing && (
          <CustomizePanel
            sections={sections}
            onChange={setSections}
            onSaved={onLayoutSaved}
            onClose={() => setCustomizing(false)}
            canViewFinancials={permissions.canViewFinancials}
          />
        )}
      </section>

      {stats.length > 0 && (
        <section className="px-5 py-4" aria-label="Relationship at a glance">
          <dl className="grid grid-cols-3 gap-3">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="text-xs text-slate-500">{s.label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{s.value}</dd>
              </div>
            ))}
          </dl>
          {showsRevenue && (
            <p className="mt-2 text-xs text-slate-500">
              Associated revenue is billed on deals they were part of — not revenue they referred. See Referrals for that.
            </p>
          )}
        </section>
      )}

      {on("contact") && (
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
      )}

      {on("notes") && (
        <section className="px-5 py-4" aria-label="Notes">
          <ProfileFields realtorId={preview.id} values={preview} fields={["notes"]} canEdit={permissions.canWrite} onSaved={onChanged} />
        </section>
      )}

      {on("activity") && (
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
      )}

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

// Per-user choice of what the card shows. Each toggle applies immediately
// and is saved to the user's account, so it follows them across devices.
function CustomizePanel({
  sections,
  onChange,
  onSaved,
  onClose,
  canViewFinancials,
}: {
  sections: PreviewSection[];
  onChange: (next: PreviewSection[]) => void;
  onSaved: () => void;
  onClose: () => void;
  canViewFinancials: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const headingId = useId();

  function save(next: PreviewSection[]) {
    const previous = sections;
    onChange(next);
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveRealtorPreviewSections(next);
        if (!result.ok) throw new Error(result.error);
        onSaved();
      } catch {
        onChange(previous);
        setError("Couldn't save your layout. Try again.");
      }
    });
  }

  const options = PREVIEW_SECTIONS.filter((s) => s.key !== "revenue" || canViewFinancials);

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      className="rounded-md border border-slate-200 bg-white p-3 shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={headingId} className="text-sm font-medium text-slate-900">
          Customize card
        </h3>
        {pending && <span className="text-xs text-slate-500">Saving…</span>}
      </div>
      <p className="mt-0.5 text-xs text-slate-500">Choose what this preview shows. Saved to your account.</p>
      <ul className="mt-3 space-y-1.5">
        {options.map((option) => (
          <li key={option.key}>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={sections.includes(option.key)}
                onChange={(e) =>
                  save(
                    e.target.checked
                      ? PREVIEW_SECTIONS.map((s) => s.key).filter((k) => k === option.key || sections.includes(k))
                      : sections.filter((k) => k !== option.key)
                  )
                }
              />
              {option.label}
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
        >
          Done
        </button>
        <button
          type="button"
          onClick={() => save(DEFAULT_PREVIEW_SECTIONS)}
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
        >
          Reset to default
        </button>
      </div>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-4 p-5" aria-hidden="true">
      <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      <div className="h-12 w-full animate-pulse rounded bg-slate-100" />
      <div className="h-8 w-full animate-pulse rounded bg-slate-100" />
      <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
    </div>
  );
}
