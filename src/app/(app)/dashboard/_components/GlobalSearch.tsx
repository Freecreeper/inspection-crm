"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { MIN_QUERY_LENGTH, SEARCH_KIND_LABELS, SEARCH_KINDS, type GlobalSearchResult } from "@/lib/search/kinds";
import { searchEverything } from "../actions";

const DEBOUNCE_MS = 200;

// Global record search. Typeahead against the server (debounced, a few
// results per record type); nothing is preloaded into the browser. Arrow
// keys move through results, Enter opens one, Escape closes.
export function GlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ for: string; items: GlobalSearchResult[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const trimmed = query.trim();
  const ready = trimmed.length >= MIN_QUERY_LENGTH;
  const items = ready && results?.for === trimmed ? results.items : [];
  const loading = ready && results?.for !== trimmed && failed !== trimmed;

  // "/" focuses search from anywhere on the page (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  function onInput(value: string) {
    setQuery(value);
    setOpen(true);
    setActive(-1);
    const q = value.trim();
    latest.current = q;
    if (timer.current) clearTimeout(timer.current);
    if (q.length < MIN_QUERY_LENGTH) return;
    timer.current = setTimeout(async () => {
      try {
        const found = await searchEverything(q);
        if (latest.current === q) setResults({ for: q, items: found });
      } catch {
        if (latest.current === q) setFailed(q);
      }
    }, DEBOUNCE_MS);
  }

  function go(result: GlobalSearchResult) {
    setOpen(false);
    setQuery("");
    router.push(result.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0 && items[active]) {
      e.preventDefault();
      go(items[active]);
    } else if (e.key === "Escape") {
      if (open) setOpen(false);
      else setQuery("");
    }
  }

  const optionId = (i: number) => `${listId}-option-${i}`;
  const showPanel = open && ready;
  let index = -1;

  return (
    <div ref={boxRef} className="relative w-full sm:w-72">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search customers, realtors, brokerages, properties, transactions, inspections
      </label>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        ref={inputRef}
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        placeholder="Search records…  /"
        value={query}
        onChange={(e) => onInput(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-600"
      />
      {showPanel && (
        <div className="absolute right-0 z-40 mt-1 max-h-[70vh] w-full min-w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg sm:w-96">
          <div id={listId} role="listbox" aria-label="Search results">
            {SEARCH_KINDS.map((kind) => {
              const group = items.filter((r) => r.kind === kind);
              if (group.length === 0) return null;
              return (
                <div key={kind} role="group" aria-labelledby={`${listId}-${kind}`}>
                  <p id={`${listId}-${kind}`} className="px-2 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {SEARCH_KIND_LABELS[kind]}
                  </p>
                  {group.map((r) => {
                    index++;
                    const i = index;
                    return (
                      <div
                        key={`${r.kind}:${r.id}`}
                        id={optionId(i)}
                        role="option"
                        aria-selected={i === active}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => go(r)}
                        onMouseEnter={() => setActive(i)}
                        className={`cursor-pointer rounded-md px-2 py-1.5 ${i === active ? "bg-emerald-50" : ""}`}
                      >
                        <span className="block truncate text-sm font-medium text-slate-900">{r.label}</span>
                        {r.sublabel && <span className="block truncate text-xs text-slate-500">{r.sublabel}</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <p className="px-2 py-1.5 text-xs text-slate-500" aria-live="polite">
            {loading ? "Searching…" : failed === trimmed ? "Search failed — try again." : items.length === 0 ? `No records match “${trimmed}”.` : `${items.length} result${items.length === 1 ? "" : "s"}`}
          </p>
        </div>
      )}
    </div>
  );
}
