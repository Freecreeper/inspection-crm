"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export type RealtorSuggestion = { id: string; label: string; sublabel?: string };

// Unlike src/components/Combobox.tsx (which picks one record's id into a
// hidden form field), this box still submits its typed text as a plain
// `q` GET param — Search/Enter keeps filtering the table exactly as
// before. The typeahead is an added affordance layered on top: pick a
// suggestion to jump straight to that realtor's page, skipping the table
// filter entirely.
export function RealtorSearchTypeahead({
  defaultValue,
  suggestions,
}: {
  defaultValue: string;
  suggestions: RealtorSuggestion[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

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

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && filtered[highlighted]) {
      // Only hijack Enter when a suggestion is actually highlighted —
      // otherwise let the surrounding <form> submit normally so Search/
      // Enter with no suggestion picked still filters the table.
      e.preventDefault();
      router.push(`/realtors/${filtered[highlighted].id}`);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex-1 min-w-[240px]">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        name="q"
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
  );
}
