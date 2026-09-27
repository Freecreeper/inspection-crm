"use client";

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

// Same table, phone cards, and pagination as the realtor directory. A row
// opens the brokerage's page (its realtors and history).
export function BrokerageDirectory({ rows, total, params }: { rows: BrokerageRowView[]; total: number; params: BrokerageDirectoryParams }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cell = "px-3 py-2.5";

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
          <caption className="sr-only">Brokerages. Select a brokerage to open it.</caption>
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortTh label="Name" sort="name" params={params} className="w-[28%]" />
              <th scope="col" className="w-[16%] px-3 py-2.5 font-medium">Phone</th>
              <th scope="col" className="w-[24%] px-3 py-2.5 font-medium">Email</th>
              <SortTh label="Address" sort="city" params={params} className="w-[32%]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr
                key={b.id}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a")) return;
                  router.push(`/brokerages/${b.id}`);
                }}
                className="cursor-pointer border-t border-slate-100 first:border-t-0 hover:bg-slate-50"
              >
                <td className={cell}>
                  <Link
                    href={`/brokerages/${b.id}`}
                    className="block truncate rounded font-medium text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                  >
                    {b.name}
                  </Link>
                </td>
                <td className={`truncate tabular-nums text-slate-600 ${cell}`}>{b.phone ? formatPhone(b.phone) : none}</td>
                <td className={`truncate text-slate-600 ${cell}`} title={b.email ?? undefined}>
                  {b.email ?? none}
                </td>
                <td className={`truncate text-slate-600 ${cell}`} title={formatBrokerageAddress(b) || undefined}>
                  {formatBrokerageAddress(b) || none}
                </td>
              </tr>
            ))}
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
              <Link href={`/brokerages/${b.id}`} className="block rounded-lg border border-slate-200 bg-white p-4">
                <p className="truncate font-medium text-slate-900">{b.name}</p>
                {contact && <p className="truncate text-sm text-slate-500">{contact}</p>}
                {address && <p className="truncate text-sm text-slate-500">{address}</p>}
              </Link>
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
    <th scope="col" aria-sort={active ? (params.dir === "asc" ? "ascending" : "descending") : "none"} className={`px-3 py-2.5 font-medium ${className}`}>
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
