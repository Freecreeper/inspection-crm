"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { sortAlphabetically } from "@/lib/sort";

export type RealtorSuggestion = { id: string; label: string; sublabel?: string };
export type BrokerageOption = { id: string; name: string };

// Everything here navigates client-side (router.push), never a native
// <form method="get"> submission. Two reasons: brokerage/sort should
// apply the moment they're picked, not wait for a separate Search click
// (real GET submissions require exactly that extra step); and a native
// GET is a full page load, which briefly remounts the shared (app) layout
// — AppSidebar's collapsed state resets to its SSR default and only
// self-corrects from localStorage after that remount's hydration effect
// runs, which is exactly the "sidebar pops open, then slides back" flash
// reported against the old <form>. Client-side navigation keeps the
// layout mounted, so that state is never touched at all.
export function RealtorFilterBar({
  initialQuery,
  initialBrokerageId,
  initialSort,
  suggestions,
  brokerages,
}: {
  initialQuery: string;
  initialBrokerageId: string;
  initialSort: string;
  suggestions: RealtorSuggestion[];
  brokerages: BrokerageOption[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const sortedBrokerages = useMemo(() => sortAlphabetically(brokerages, (b) => b.name), [brokerages]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return suggestions
      .filter((s) => s.label.toLowerCase().includes(q) || (s.sublabel ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, suggestions]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function navigate(overrides: { q?: string; brokerageId?: string; sort?: string }) {
    const params = new URLSearchParams();
    const nextQ = overrides.q ?? query;
    const nextBrokerageId = overrides.brokerageId ?? initialBrokerageId;
    const nextSort = overrides.sort ?? initialSort;
    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextBrokerageId) params.set("brokerageId", nextBrokerageId);
    if (nextSort && nextSort !== "name") params.set("sort", nextSort);
    const qs = params.toString();
    router.push(qs ? `/realtors?${qs}` : "/realtors");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (open && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((prev) => Math.min(prev + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter" && filtered[highlighted]) {
        e.preventDefault();
        router.push(`/realtors/${filtered[highlighted].id}`);
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      setOpen(false);
      navigate({});
    }
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <div ref={containerRef} className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open && filtered.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search realtors by name, email, or brokerage..."
          className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        {open && filtered.length > 0 && (
          <div id={listboxId} role="listbox" className="absolute z-20 mt-1 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
            {filtered.map((s, index) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={index === highlighted}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => router.push(`/realtors/${s.id}`)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  index === highlighted ? "bg-emerald-50 text-emerald-800" : "text-slate-700"
                }`}
              >
                {s.label}
                {s.sublabel && <span className="ml-1.5 text-xs text-slate-400">{s.sublabel}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <select
        defaultValue={initialBrokerageId}
        onChange={(e) => navigate({ brokerageId: e.target.value })}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <option value="">All brokerages</option>
        {sortedBrokerages.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>

      <select
        defaultValue={initialSort}
        onChange={(e) => navigate({ sort: e.target.value })}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <option value="name">Sort by name</option>
        <option value="transactions">Sort by transactions</option>
        <option value="brokerage">Sort by brokerage</option>
      </select>

      <button
        type="button"
        onClick={() => navigate({})}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Search
      </button>
    </div>
  );
}
