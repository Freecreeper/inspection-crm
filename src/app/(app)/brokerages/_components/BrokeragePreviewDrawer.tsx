"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Drawer } from "@/components/Drawer";
import { formatShortDate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import type { BrokeragePreview } from "@/lib/brokerages/preview";
import { getBrokeragePreview } from "../actions";
import { BrokerageContactFields, BrokerageQuickActions } from "./BrokerageShared";

type LoadState = { status: "loading" } | { status: "ready"; preview: BrokeragePreview } | { status: "missing" } | { status: "error" };

// The brokerage counterpart of RealtorPreviewDrawer: opened by selecting a
// directory row, it fetches that one brokerage on demand. A response for a
// brokerage that's no longer selected is ignored, so fast clicking can't
// show stale data.
export function BrokeragePreviewDrawer({ brokerageId, onClose, onChanged }: { brokerageId: string | null; onClose: () => void; onChanged: () => void }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const requestRef = useRef(0);

  const load = useCallback(async (id: string, showSpinner: boolean) => {
    const request = ++requestRef.current;
    if (showSpinner) setState({ status: "loading" });
    try {
      const preview = await getBrokeragePreview(id);
      if (request !== requestRef.current) return;
      setState(preview ? { status: "ready", preview } : { status: "missing" });
    } catch {
      if (request === requestRef.current) setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-select; load() sets state after an await
    if (brokerageId) load(brokerageId, true);
  }, [brokerageId, load]);

  const refresh = useCallback(() => {
    if (brokerageId) load(brokerageId, false);
    onChanged();
  }, [brokerageId, load, onChanged]);

  const title = state.status === "ready" ? state.preview.name : state.status === "loading" ? "Loading…" : "Brokerage";

  return (
    <Drawer open={brokerageId !== null} onClose={onClose} title={title} titleId="brokerage-preview-title" focusKey={brokerageId}>
      {state.status === "loading" && <DrawerSkeleton />}
      {state.status === "missing" && <p className="p-5 text-sm text-muted-foreground">This brokerage no longer exists or has been archived.</p>}
      {state.status === "error" && <p className="p-5 text-sm text-danger-strong">Couldn&apos;t load this brokerage. Try again.</p>}
      {state.status === "ready" && <PreviewBody preview={state.preview} onChanged={refresh} />}
    </Drawer>
  );
}

function PreviewBody({ preview, onChanged }: { preview: BrokeragePreview; onChanged: () => void }) {
  const { stats, permissions } = preview;
  return (
    <div className="divide-y divide-neutral-100">
      <section className="space-y-3 px-5 py-4" aria-label="Summary">
        <p className="text-sm text-neutral-600">{preview.address || <span className="text-subtle">No address on file</span>}</p>
        <BrokerageQuickActions brokerageId={preview.id} phone={preview.phone} email={preview.email} showOpenRecord />
      </section>

      <section className="px-5 py-4" aria-label="At a glance">
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dt className="text-xs text-muted-foreground">Realtors</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{stats.currentRealtors}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Transactions</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{stats.transactions}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last transaction</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
              {stats.lastTransactionAt ? formatShortDate(stats.lastTransactionAt) : <span className="text-subtle">None</span>}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">Transactions are deals a realtor worked while at this brokerage.</p>
      </section>

      <section className="px-5 py-4" aria-labelledby="brokerage-drawer-contact">
        <h3 id="brokerage-drawer-contact" className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Contact
        </h3>
        <BrokerageContactFields brokerageId={preview.id} values={preview} canEdit={permissions.canWrite} onSaved={onChanged} />
      </section>

      <section className="px-5 py-4" aria-labelledby="brokerage-drawer-realtors">
        <h3 id="brokerage-drawer-realtors" className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Realtors
        </h3>
        {preview.realtors.length > 0 ? (
          <ul className="space-y-2">
            {preview.realtors.map((r) => (
              <li key={r.id} className="text-sm">
                <Link href={`/realtors/${r.id}`} className="font-medium text-foreground hover:underline">
                  {r.name}
                </Link>
                {(r.phone || r.email) && (
                  <p className="truncate text-xs text-muted-foreground">{[r.phone ? formatPhone(r.phone) : null, r.email].filter(Boolean).join(" · ")}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No current realtors.</p>
        )}
        {stats.currentRealtors > preview.realtors.length && (
          <Link href={`/brokerages/${preview.id}`} className="mt-2 inline-block text-sm text-link hover:underline">
            View all {stats.currentRealtors} realtors
          </Link>
        )}
      </section>

      <div className="px-5 py-4">
        <Link
          href={`/brokerages/${preview.id}`}
          className="block w-full rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Open full brokerage record
        </Link>
      </div>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-4 p-5" aria-hidden="true">
      <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-100" />
      <div className="h-8 w-full animate-pulse rounded bg-neutral-100" />
      <div className="h-12 w-full animate-pulse rounded bg-neutral-100" />
      <div className="h-24 w-full animate-pulse rounded bg-neutral-100" />
    </div>
  );
}
