"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Search, User, X } from "lucide-react";

export type SearchSuggestion = {
  id: string;
  label: string;
  sublabel?: string;
  kind: "realtor" | "brokerage";
};

const DEBOUNCE_MS = 250;
const MAX_REALTORS = 6;
const MAX_BROKERAGES = 3;

function rank(label: string, q: string) {
  const lower = label.toLowerCase();
  if (lower.startsWith(q)) return 0;
  if (lower.split(/\s+/).some((word) => word.startsWith(q))) return 1;
  return 2;
}

// One predictive search box in place of the old text box + brokerage
// <select> + Search button. The table filters live as you type (debounced
// router.replace, so it doesn't pile up history entries), and the dropdown
// suggests matching realtors (jump to profile) and brokerages (filter the
// table to that brokerage). Navigation stays client-side for the same
// reason as before: a native GET would remount the (app) layout and
// flash the collapsed sidebar open.
export function RealtorFilterBar({
  initialQuery,
  suggestions,
}: {
  initialQuery: string;
  suggestions: SearchSuggestion[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  // -1 = nothing highlighted, so Enter just applies the typed text rather
  // than jumping to whichever suggestion happens to be first.
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const byRank = (a: SearchSuggestion, b: SearchSuggestion) => rank(a.label, q) - rank(b.label, q);
    // Picking a brokerage just searches by its name, so same-named
    // brokerages would be indistinguishable duplicate rows — keep one.
    const seenBrokerageNames = new Set<string>();
    const brokerages = suggestions
      .filter((s) => {
        if (s.kind !== "brokerage" || !s.label.toLowerCase().includes(q)) return false;
        const key = s.label.toLowerCase();
        if (seenBrokerageNames.has(key)) return false;
        seenBrokerageNames.add(key);
        return true;
      })
      .sort(byRank)
      .slice(0, MAX_BROKERAGES);
    const realtors = suggestions
      .filter(
        (s) => s.kind === "realtor" && (s.label.toLowerCase().includes(q) || (s.sublabel ?? "").toLowerCase().includes(q))
      )
      .sort(byRank)
      .slice(0, MAX_REALTORS);
    return [...realtors, ...brokerages];
  }, [query, suggestions]);

  useEffect(() => {
    const next = query.trim();
    if (next === (searchParams.get("q") ?? "")) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set("q", next);
      else params.delete("q");
      const qs = params.toString();
      router.replace(qs ? `/realtors?${qs}` : "/realtors", { scroll: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, searchParams, router]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function choose(suggestion: SearchSuggestion) {
    setOpen(false);
    setHighlighted(-1);
    if (suggestion.kind === "realtor") {
      router.push(`/realtors/${suggestion.id}`);
    } else {
      setQuery(suggestion.label);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && filtered.length > 0) {
      e.preventDefault();
      setOpen(true);
      setHighlighted((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp" && filtered.length > 0) {
      e.preventDefault();
      setHighlighted((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && highlighted >= 0 && filtered[highlighted]) choose(filtered[highlighted]);
      else setOpen(false);
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
    }
  }

  const showList = open && filtered.length > 0;

  return (
    <div ref={containerRef} className="relative mt-6">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlighted(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search realtors by name, email, or brokerage..."
        className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-9 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery("");
            setHighlighted(-1);
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {showList && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {filtered.map((s, index) => {
            const Icon = s.kind === "realtor" ? User : Building2;
            return (
              <button
                key={`${s.kind}-${s.id}`}
                type="button"
                role="option"
                aria-selected={index === highlighted}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(s)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  index === highlighted ? "bg-emerald-50 text-emerald-800" : "text-slate-700"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate">{s.label}</span>
                {s.sublabel && <span className="truncate text-xs text-slate-400">{s.sublabel}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
