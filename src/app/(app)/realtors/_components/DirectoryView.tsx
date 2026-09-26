"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { formatPhone } from "@/lib/phone";
import { formatShortDate, startOfDay } from "@/lib/dates";
import { DIRECTORY_PAGE_SIZE, type DirectoryParams, type DirectorySort } from "@/lib/realtors/directoryParams";
import { directoryHref, nextSortChange } from "@/lib/realtors/urls";
import { realtorDisplayName } from "@/lib/realtors/display";
import { StatusBadge } from "./StatusBadge";
import { RealtorPreviewDrawer } from "./RealtorPreviewDrawer";

export interface DirectoryRowView {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
  brokerageId: string | null;
  brokerageName: string | null;
  transactionCount: number;
  referralCount: number;
  lastActivityAt: string | null;
  nextFollowUpAt: string | null;
}

// Keeps the ?selected= param in sync without a server round trip — the
// directory data doesn't change when the selection does, so there's no
// reason to re-render the page on the server (Next's router picks up
// history.replaceState for useSearchParams).
function writeSelectedToUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("selected", id);
  else url.searchParams.delete("selected");
  window.history.replaceState(null, "", url.pathname + url.search);
}

export function DirectoryView({
  rows,
  total,
  params,
  initialSelectedId,
}: {
  rows: DirectoryRowView[];
  total: number;
  params: DirectoryParams;
  initialSelectedId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  // A navigation that arrives with a new ?selected= (e.g. right after
  // creating a realtor) opens that one, without remounting the directory.
  const [prevInitialSelectedId, setPrevInitialSelectedId] = useState(initialSelectedId);
  if (initialSelectedId !== prevInitialSelectedId) {
    setPrevInitialSelectedId(initialSelectedId);
    if (initialSelectedId) setSelectedId(initialSelectedId);
  }
  const tableRef = useRef<HTMLTableSectionElement>(null);
  const todayStart = startOfDay(new Date());

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    writeSelectedToUrl(id);
  }, []);

  // Closing returns focus to the realtor that was open (whichever of the
  // table row or phone card is actually on screen), even when the drawer
  // was opened from the URL rather than by a click.
  const closeDrawer = useCallback(() => {
    const id = selectedId;
    select(null);
    requestAnimationFrame(() => {
      const targets = document.querySelectorAll<HTMLElement>(`[data-realtor-id="${id}"]`);
      Array.from(targets).find((el) => el.offsetParent !== null)?.focus();
    });
  }, [selectedId, select]);

  function onRowKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const buttons = tableRef.current?.querySelectorAll<HTMLButtonElement>("button[data-row-index]");
    if (!buttons) return;
    let target: number | null = null;
    if (e.key === "ArrowDown") target = Math.min(index + 1, buttons.length - 1);
    else if (e.key === "ArrowUp") target = Math.max(index - 1, 0);
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = buttons.length - 1;
    if (target === null) return;
    e.preventDefault();
    buttons[target].focus();
  }

  const start = total === 0 ? 0 : (params.page - 1) * DIRECTORY_PAGE_SIZE + 1;
  const end = Math.min(params.page * DIRECTORY_PAGE_SIZE, total);
  const hasPrev = params.page > 1;
  const hasNext = end < total;

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {total === 1 ? "1 realtor" : `${total} realtors`} found
      </p>

      {/* Desktop / tablet: table */}
      <div className="mt-4 hidden rounded-lg border border-slate-200 bg-white md:block">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Realtors. Select a realtor to open their preview.</caption>
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortTh label="Realtor" sort="name" params={params} className="w-[21%]" />
              <SortTh label="Brokerage" sort="brokerage" params={params} className="w-[17%]" />
              <th scope="col" className="w-[13%] px-3 py-2.5 font-medium">Phone</th>
              <th scope="col" className="hidden w-[18%] px-3 py-2.5 font-medium xl:table-cell">Email</th>
              <SortTh label="Transactions" shortLabel="Trans." sort="transactions" params={params} className="w-[9%]" numeric />
              <SortTh label="Referrals" shortLabel="Refs" sort="referrals" params={params} className="w-[8%]" numeric />
              <SortTh label="Last activity" sort="lastActivity" params={params} className="w-[11%]" />
              <th scope="col" className="w-[10%] px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody ref={tableRef}>
            {rows.map((r, index) => {
              const selected = r.id === selectedId;
              const overdue = r.nextFollowUpAt ? new Date(r.nextFollowUpAt) < todayStart : false;
              return (
                <tr
                  key={r.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a")) return;
                    select(r.id);
                  }}
                  className={`cursor-pointer border-t border-slate-100 first:border-t-0 ${
                    selected ? "bg-emerald-50/70 shadow-[inset_3px_0_0_0_var(--color-emerald-600)]" : "hover:bg-slate-50"
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      data-row-index={index}
                      data-realtor-id={r.id}
                      aria-haspopup="dialog"
                      aria-current={selected ? "true" : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        select(r.id);
                      }}
                      onKeyDown={(e) => onRowKeyDown(e, index)}
                      className="block w-full truncate rounded text-left font-medium text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    >
                      {realtorDisplayName(r)}
                    </button>
                  </td>
                  <td className="truncate px-3 py-2.5 text-slate-600">
                    {r.brokerageId ? (
                      <Link href={`/brokerages/${r.brokerageId}`} className="hover:text-slate-900 hover:underline">
                        {r.brokerageName}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="truncate px-3 py-2.5 tabular-nums text-slate-600">{r.phone ? formatPhone(r.phone) : <span className="text-slate-400">—</span>}</td>
                  <td className="hidden truncate px-3 py-2.5 text-slate-600 xl:table-cell">{r.email ?? <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.transactionCount}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.referralCount}</td>
                  <td className="truncate px-3 py-2.5 tabular-nums text-slate-600">
                    {r.lastActivityAt ? formatShortDate(r.lastActivityAt) : <span className="text-slate-400">None</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge active={r.active} followUpOverdue={overdue} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-slate-500">
                  <EmptyState page={params.page} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Phones: cards */}
      <ul className="mt-4 space-y-2 md:hidden" aria-label="Realtors">
        {rows.map((r) => {
          const selected = r.id === selectedId;
          const overdue = r.nextFollowUpAt ? new Date(r.nextFollowUpAt) < todayStart : false;
          return (
            <li key={r.id}>
              <button
                type="button"
                data-realtor-id={r.id}
                aria-haspopup="dialog"
                aria-current={selected ? "true" : undefined}
                onClick={() => select(r.id)}
                className={`w-full rounded-lg border bg-white p-4 text-left ${selected ? "border-emerald-500" : "border-slate-200"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{realtorDisplayName(r)}</p>
                    <p className="truncate text-sm text-slate-500">{r.brokerageName ?? "No brokerage"}</p>
                  </div>
                  <StatusBadge active={r.active} followUpOverdue={overdue} />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {r.transactionCount} transactions · {r.referralCount} referrals ·{" "}
                  {r.lastActivityAt ? `Last activity ${formatShortDate(r.lastActivityAt)}` : "No activity yet"}
                </p>
              </button>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            <EmptyState page={params.page} />
          </li>
        )}
      </ul>

      <nav className="mt-3 flex items-center justify-between text-xs text-slate-500" aria-label="Pagination">
        <p>{total > 0 ? `Showing ${start}–${end} of ${total}` : " "}</p>
        <div className="flex gap-2">
          {hasPrev && (
            <Link href={directoryHref(searchParams, { page: String(params.page - 1) }, { resetPage: false })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
              Previous
            </Link>
          )}
          {hasNext && (
            <Link href={directoryHref(searchParams, { page: String(params.page + 1) }, { resetPage: false })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
              Next
            </Link>
          )}
        </div>
      </nav>

      <RealtorPreviewDrawer realtorId={selectedId} onClose={closeDrawer} onChanged={() => router.refresh()} />
    </>
  );
}

function EmptyState({ page }: { page: number }) {
  if (page > 1) {
    return (
      <>
        No realtors on this page.{" "}
        <Link href="/realtors" className="text-emerald-700 hover:underline">
          Back to the first page
        </Link>
      </>
    );
  }
  return <>No realtors match. Try a different search or clear a filter.</>;
}

function SortTh({
  label,
  shortLabel,
  sort,
  params,
  className,
  numeric = false,
}: {
  label: string;
  shortLabel?: string;
  sort: DirectorySort;
  params: DirectoryParams;
  className: string;
  numeric?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = params.sort === sort;
  const Icon = active ? (params.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const ariaSort = active ? (params.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th scope="col" aria-sort={ariaSort} className={`px-3 py-2.5 font-medium ${numeric ? "text-right" : ""} ${className}`}>
      <button
        type="button"
        onClick={() => router.replace(directoryHref(searchParams, nextSortChange(params.sort, params.dir, sort)), { scroll: false })}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-800 ${numeric ? "flex-row-reverse" : ""} ${active ? "text-slate-800" : ""}`}
      >
        {shortLabel ? (
          <>
            <span className="2xl:hidden" aria-hidden="true">{shortLabel}</span>
            <span className="hidden 2xl:inline" aria-hidden="true">{label}</span>
            <span className="sr-only">{label}</span>
          </>
        ) : (
          label
        )}
        <Icon className={`h-3.5 w-3.5 ${active ? "text-slate-700" : "text-slate-300"}`} aria-hidden="true" />
      </button>
    </th>
  );
}
