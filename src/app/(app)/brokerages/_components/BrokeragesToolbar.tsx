"use client";

import { useEffect, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { brokerageDirectoryHref, type BrokerageDirectoryParams } from "@/lib/brokerages/directoryParams";
import { SEARCH_DEBOUNCE_MS } from "../../realtors/_components/DirectoryToolbar";

const SORT_OPTIONS = [
  { value: "name:asc", label: "Name (A–Z)" },
  { value: "name:desc", label: "Name (Z–A)" },
  { value: "city:asc", label: "City (A–Z)" },
  { value: "city:desc", label: "City (Z–A)" },
];

// Typeahead search like the realtor directory: every keystroke (debounced)
// re-queries one page on the server — no Enter, no search button.
export function BrokeragesToolbar({ params }: { params: BrokerageDirectoryParams }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(params.q);
  const searchId = useId();

  useEffect(() => {
    const next = query.trim();
    if (next === (searchParams.get("q") ?? "")) return;
    const timer = setTimeout(() => {
      router.replace(brokerageDirectoryHref(searchParams, { q: next || null }), { scroll: false });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, searchParams, router]);

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <label htmlFor={searchId} className="sr-only">
          Search brokerages
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brokerages"
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

      {/* Phones have no column headers to click, so sorting lives here. */}
      <label className="md:hidden">
        <span className="sr-only">Sort by</span>
        <select
          value={`${params.sort}:${params.dir}`}
          onChange={(e) => {
            const [sort, dir] = e.target.value.split(":");
            router.replace(brokerageDirectoryHref(searchParams, { sort, dir }), { scroll: false });
          }}
          className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
