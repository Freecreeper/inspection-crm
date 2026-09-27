"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";

export type AsyncOption = { id: string; label: string; sublabel?: string };

const DEBOUNCE_MS = 200;

// A typeahead whose options come from the server as the user types (a
// debounced search action returning a handful of matches), for record sets
// too large to preload — customers, properties, realtors. Keyboard: ↑/↓ to
// move, Enter to pick, Escape to close. `onCreate` adds a trailing
// "+ Create “query”" row when the search finds nothing appropriate.
export function AsyncCombobox({
  label,
  value,
  onChange,
  search,
  placeholder = "Search…",
  onCreate,
  createLabel = (q: string) => `+ Create “${q}”`,
  required = false,
}: {
  label: string;
  value: AsyncOption | null;
  onChange: (option: AsyncOption | null) => void;
  search: (q: string) => Promise<AsyncOption[]>;
  placeholder?: string;
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  required?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setOptions] = useState<AsyncOption[]>([]);
  const [open, setOpen] = useState(false);
  // Which query the current results answer; "loading" is simply "not this one yet".
  const [resultsFor, setResultsFor] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const requestRef = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 1) return;
    const request = ++requestRef.current;
    const timer = setTimeout(async () => {
      let found: AsyncOption[] = [];
      try {
        found = await search(q);
      } catch {
        found = [];
      }
      if (request === requestRef.current) {
        setOptions(found);
        setResultsFor(q);
        setHighlighted(0);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open, search]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = query.trim();
  // Stale results from an earlier query are never shown for an empty box.
  const loading = open && q.length > 0 && resultsFor !== q;
  const options = open && q && !loading ? results : [];
  const rows: ({ kind: "option"; option: AsyncOption } | { kind: "create" })[] = [
    ...options.map((option) => ({ kind: "option" as const, option })),
    ...(onCreate && q && !loading ? [{ kind: "create" as const }] : []),
  ];

  function choose(index: number) {
    const row = rows[index];
    if (!row) return;
    if (row.kind === "create") onCreate?.(q);
    else onChange(row.option);
    setOpen(false);
    setQuery("");
  }

  if (value) {
    return (
      <div>
        <span className="block text-sm font-medium text-slate-700">{label}</span>
        <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-sm">
          <span className="min-w-0">
            <span className="block truncate font-medium text-slate-900">{value.label}</span>
            {value.sublabel && <span className="block truncate text-xs text-slate-500">{value.sublabel}</span>}
          </span>
          <button type="button" onClick={() => onChange(null)} aria-label={`Clear ${label}`} className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
        {!required && <span className="font-normal text-slate-400"> (optional)</span>}
      </label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          id={id}
          role="combobox"
          aria-expanded={open && q.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && rows.length ? `${id}-opt-${highlighted}` : undefined}
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlighted((h) => Math.min(h + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && open && rows.length) {
              e.preventDefault();
              choose(highlighted);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>
      {open && q.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {loading && options.length === 0 && <li className="px-3 py-2 text-slate-500">Searching…</li>}
          {!loading && options.length === 0 && !onCreate && <li className="px-3 py-2 text-slate-500">No matches.</li>}
          {rows.map((row, index) => (
            <li
              key={row.kind === "create" ? "__create" : row.option.id}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={index === highlighted}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(index);
              }}
              onMouseEnter={() => setHighlighted(index)}
              className={`cursor-pointer px-3 py-1.5 ${index === highlighted ? "bg-emerald-50" : ""} ${row.kind === "create" ? "border-t border-slate-100 font-medium text-emerald-700" : ""}`}
            >
              {row.kind === "create" ? (
                createLabel(q)
              ) : (
                <>
                  <span className="block truncate text-slate-900">{row.option.label}</span>
                  {row.option.sublabel && <span className="block truncate text-xs text-slate-500">{row.option.sublabel}</span>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
