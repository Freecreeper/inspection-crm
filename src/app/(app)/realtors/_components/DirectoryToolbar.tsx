"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import {
  ACTIVITY_RANGES,
  ACTIVITY_RANGE_LABELS,
  FLAG_FILTERS,
  FLAG_FILTER_KEYS,
  activeFilterCount,
  type DirectoryParams,
  type DirectorySort,
} from "@/lib/realtors/directoryParams";
import { directoryHref } from "@/lib/realtors/urls";

export const SEARCH_DEBOUNCE_MS = 250;

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "name:asc", label: "Name (A–Z)" },
  { value: "name:desc", label: "Name (Z–A)" },
  { value: "brokerage:asc", label: "Brokerage" },
  { value: "lastActivity:desc", label: "Most recent activity" },
  { value: "lastActivity:asc", label: "Least recent activity" },
  { value: "transactions:desc", label: "Most transactions" },
  { value: "referrals:desc", label: "Most referrals" },
];

// Search, filters, and (on small screens, where there are no column
// headers to click) sorting. Every change is a client-side router.replace
// — the server re-queries one page of results — so typing never requires
// Enter and never loads the whole realtor list into the browser.
export function DirectoryToolbar({
  params,
  brokerages,
}: {
  params: DirectoryParams;
  brokerages: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(params.q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const searchId = useId();

  function apply(changes: Record<string, string | null>) {
    router.replace(directoryHref(searchParams, changes), { scroll: false });
  }

  useEffect(() => {
    const next = query.trim();
    if (next === (searchParams.get("q") ?? "")) return;
    const timer = setTimeout(() => {
      router.replace(directoryHref(searchParams, { q: next || null }), { scroll: false });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, searchParams, router]);

  useEffect(() => {
    if (!filtersOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) setFiltersOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setFiltersOpen(false);
        filtersButtonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filtersOpen]);

  const filterCount = activeFilterCount(params);
  const brokerageName = params.brokerageId ? brokerages.find((b) => b.id === params.brokerageId)?.name ?? "Selected brokerage" : null;

  const chips: { key: string; label: string; clear: Record<string, null> }[] = [];
  if (params.status !== "all") chips.push({ key: "status", label: params.status === "active" ? "Active" : "Inactive", clear: { status: null } });
  if (brokerageName) chips.push({ key: "brokerageId", label: brokerageName, clear: { brokerageId: null } });
  for (const key of FLAG_FILTER_KEYS) if (params.flags[key]) chips.push({ key, label: FLAG_FILTERS[key], clear: { [key]: null } });
  if (params.activity) chips.push({ key: "activity", label: ACTIVITY_RANGE_LABELS[params.activity], clear: { activity: null } });

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <label htmlFor={searchId} className="sr-only">
            Search realtors
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, brokerage, phone, or email"
            autoComplete="off"
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div ref={filtersRef} className="relative">
          <button
            ref={filtersButtonRef}
            type="button"
            aria-expanded={filtersOpen}
            aria-controls={panelId}
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Filters
            {filterCount > 0 && (
              <span className="rounded-full bg-slate-900 px-1.5 text-xs font-semibold text-white">
                {filterCount}
                <span className="sr-only"> active</span>
              </span>
            )}
          </button>
          {filtersOpen && (
            <div
              id={panelId}
              role="group"
              aria-label="Filter realtors"
              className="absolute right-0 z-20 mt-1 w-72 space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
            >
              <fieldset>
                <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</legend>
                <div className="mt-2 flex gap-3 text-sm">
                  {(["all", "active", "inactive"] as const).map((s) => (
                    <label key={s} className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="status"
                        checked={params.status === s}
                        onChange={() => apply({ status: s === "all" ? null : s })}
                      />
                      {s === "all" ? "All" : s === "active" ? "Active" : "Inactive"}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor={`${panelId}-brokerage`} className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Brokerage
                </label>
                <select
                  id={`${panelId}-brokerage`}
                  value={params.brokerageId ?? ""}
                  onChange={(e) => apply({ brokerageId: e.target.value || null, missingBrokerage: null })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Any brokerage</option>
                  {brokerages.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset>
                <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">Show only</legend>
                <div className="mt-2 space-y-1.5 text-sm">
                  {FLAG_FILTER_KEYS.map((key) => (
                    <label key={key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={params.flags[key]}
                        onChange={(e) =>
                          apply({ [key]: e.target.checked ? "1" : null, ...(key === "missingBrokerage" && e.target.checked ? { brokerageId: null } : {}) })
                        }
                      />
                      {FLAG_FILTERS[key]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor={`${panelId}-activity`} className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Last activity
                </label>
                <select
                  id={`${panelId}-activity`}
                  value={params.activity ?? ""}
                  onChange={(e) => apply({ activity: e.target.value || null })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Any time</option>
                  {ACTIVITY_RANGES.map((r) => (
                    <option key={r} value={r}>
                      {ACTIVITY_RANGE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <label className="md:hidden">
          <span className="sr-only">Sort by</span>
          <select
            value={`${params.sort}:${params.dir}`}
            onChange={(e) => {
              const [sort, dir] = e.target.value.split(":") as [DirectorySort, string];
              apply({ sort, dir });
            }}
            className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {!SORT_OPTIONS.some((o) => o.value === `${params.sort}:${params.dir}`) && (
              <option value={`${params.sort}:${params.dir}`}>Custom sort</option>
            )}
          </select>
        </label>
      </div>

      {chips.length > 0 && (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                onClick={() => apply(chip.clear)}
                className="flex items-center gap-1 rounded-full border border-slate-200 bg-white py-0.5 pl-2.5 pr-1.5 text-xs text-slate-700 hover:bg-slate-50"
              >
                {chip.label}
                <X className="h-3 w-3 text-slate-400" aria-hidden="true" />
                <span className="sr-only">(remove filter)</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() =>
                apply({ status: null, brokerageId: null, activity: null, ...Object.fromEntries(FLAG_FILTER_KEYS.map((k) => [k, null])) })
              }
              className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
            >
              Clear all
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
