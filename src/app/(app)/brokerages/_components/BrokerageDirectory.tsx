"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { formatPhone } from "@/lib/phone";
import {
  BROKERAGE_PAGE_SIZE,
  brokerageDirectoryHref,
  formatBrokerageAddress,
  nextBrokerageSort,
  type BrokerageDirectoryParams,
  type BrokerageSort,
} from "@/lib/brokerages/directoryParams";
import { BrokeragePreviewDrawer } from "./BrokeragePreviewDrawer";

export interface BrokerageRowView {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const none = <span className="text-slate-400">—</span>;

// Keeps ?selected= in sync without a server round trip, as the realtor
// directory does — the list doesn't change when the selection does.
function writeSelectedToUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("selected", id);
  else url.searchParams.delete("selected");
  window.history.replaceState(null, "", url.pathname + url.search);
}

// Same table, phone cards, pagination, and preview drawer as the realtor
// directory. Selecting a row opens the brokerage's preview; the drawer
// links on to the full record.
export function BrokerageDirectory({
  rows,
  total,
  params,
  initialSelectedId,
}: {
  rows: BrokerageRowView[];
  total: number;
  params: BrokerageDirectoryParams;
  initialSelectedId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cell = "px-3 py-2.5";
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    writeSelectedToUrl(id);
  }, []);

  // Closing returns focus to the brokerage that was open (row or card,
  // whichever is on screen), even when the drawer was opened from the URL.
  const closeDrawer = useCallback(() => {
    const id = selectedId;
    select(null);
    requestAnimationFrame(() => {
      const targets = document.querySelectorAll<HTMLElement>(`[data-brokerage-id="${id}"]`);
      Array.from(targets)
        .find((el) => el.offsetParent !== null)
        ?.focus();
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

  const start = total === 0 ? 0 : (params.page - 1) * BROKERAGE_PAGE_SIZE + 1;
  const end = Math.min(params.page * BROKERAGE_PAGE_SIZE, total);
  const hasPrev = params.page > 1;
  const hasNext = end < total;

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {total === 1 ? "1 brokerage" : `${total} brokerages`} found
      </p>

      {/* Desktop / tablet: table */}
      <div className="mt-4 hidden rounded-lg border border-slate-200 bg-white md:block">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Brokerages. Select a brokerage to open its preview.</caption>
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortTh label="Name" sort="name" params={params} className="w-[28%]" />
              <th scope="col" className="w-[16%] px-3 py-2.5 font-medium">
                Phone
              </th>
              <th scope="col" className="w-[24%] px-3 py-2.5 font-medium">
                Email
              </th>
              <SortTh label="Address" sort="city" params={params} className="w-[32%]" />
            </tr>
          </thead>
          <tbody ref={tableRef}>
            {rows.map((b, index) => {
              const selected = b.id === selectedId;
              return (
                <tr
                  key={b.id}
                  onClick={() => select(b.id)}
                  className={`cursor-pointer border-t border-slate-100 first:border-t-0 ${
                    selected ? "bg-emerald-50/70 shadow-[inset_3px_0_0_0_var(--color-emerald-600)]" : "hover:bg-slate-50"
                  }`}
                >
                  <td className={cell}>
                    <button
                      type="button"
                      data-row-index={index}
                      data-brokerage-id={b.id}
                      aria-haspopup="dialog"
                      aria-current={selected ? "true" : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        select(b.id);
                      }}
                      onKeyDown={(e) => onRowKeyDown(e, index)}
                      className="block w-full truncate rounded text-left font-medium text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    >
                      {b.name}
                    </button>
                  </td>
                  <td className={`truncate tabular-nums text-slate-600 ${cell}`}>{b.phone ? formatPhone(b.phone) : none}</td>
                  <td className={`truncate text-slate-600 ${cell}`} title={b.email ?? undefined}>
                    {b.email ?? none}
                  </td>
                  <td className={`truncate text-slate-600 ${cell}`} title={formatBrokerageAddress(b) || undefined}>
                    {formatBrokerageAddress(b) || none}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-12 text-center text-slate-500">
                  <EmptyState page={params.page} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Phones: cards */}
      <ul className="mt-4 space-y-2 md:hidden" aria-label="Brokerages">
        {rows.map((b) => {
          const address = formatBrokerageAddress(b);
          const contact = [b.phone ? formatPhone(b.phone) : null, b.email].filter(Boolean).join(" · ");
          return (
            <li key={b.id}>
              <button
                type="button"
                data-brokerage-id={b.id}
                aria-haspopup="dialog"
                aria-current={b.id === selectedId ? "true" : undefined}
                onClick={() => select(b.id)}
                className={`block w-full rounded-lg border bg-white p-4 text-left ${b.id === selectedId ? "border-emerald-500" : "border-slate-200"}`}
              >
                <p className="truncate font-medium text-slate-900">{b.name}</p>
                {contact && <p className="truncate text-sm text-slate-500">{contact}</p>}
                {address && <p className="truncate text-sm text-slate-500">{address}</p>}
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
        <p>{total > 0 ? `Showing ${start}–${end} of ${total}` : " "}</p>
        <div className="flex gap-2">
          {hasPrev && (
            <Link
              href={brokerageDirectoryHref(searchParams, { page: String(params.page - 1) }, { resetPage: false })}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Previous
            </Link>
          )}
          {hasNext && (
            <Link
              href={brokerageDirectoryHref(searchParams, { page: String(params.page + 1) }, { resetPage: false })}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Next
            </Link>
          )}
        </div>
      </nav>

      <BrokeragePreviewDrawer brokerageId={selectedId} onClose={closeDrawer} onChanged={() => router.refresh()} />
    </>
  );
}

function EmptyState({ page }: { page: number }) {
  if (page > 1) {
    return (
      <>
        No brokerages on this page.{" "}
        <Link href="/brokerages" className="text-emerald-700 hover:underline">
          Back to the first page
        </Link>
      </>
    );
  }
  return <>No brokerages match. Try a different search.</>;
}

function SortTh({ label, sort, params, className }: { label: string; sort: BrokerageSort; params: BrokerageDirectoryParams; className: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = params.sort === sort;
  const Icon = active ? (params.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (params.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-3 py-2.5 font-medium ${className}`}
    >
      <button
        type="button"
        onClick={() => router.replace(brokerageDirectoryHref(searchParams, nextBrokerageSort(params, sort)), { scroll: false })}
        title={sort === "city" ? "Sort by city" : undefined}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-800 ${active ? "text-slate-800" : ""}`}
      >
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? "text-slate-700" : "text-slate-300"}`} aria-hidden="true" />
      </button>
    </th>
  );
}
