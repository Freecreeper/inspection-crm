"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { sortAlphabetically } from "@/lib/sort";

export type ComboboxOption = { id: string; label: string; sublabel?: string };

// A searchable, keyboard-navigable typeahead for picking one existing
// relational record (a Customer, Realtor, Brokerage, Property, ...) out of
// a list already fetched by the server component that renders this. It's
// still a real form field — the actual submitted value is a hidden
// <input name={name}>, so it drops into any <form action={serverAction}>
// exactly like a plain <select> would.
//
// `renderCreateNew`, if given, adds a trailing "+ Add new …" row. Selecting
// it opens a modal this component owns (backdrop, positioning, cancel);
// the caller only supplies the form fields and the create logic via a
// render prop, and calls back with the newly created option once it
// exists — Combobox appends it to its own option list and selects it.
export function Combobox({
  name,
  options,
  defaultValue = "",
  placeholder = "Search…",
  emptyMessage = "No matches.",
  required = false,
  createNewLabel = "+ Add new",
  renderCreateNew,
  onSelect,
}: {
  name: string;
  options: ComboboxOption[];
  defaultValue?: string;
  placeholder?: string;
  emptyMessage?: string;
  required?: boolean;
  createNewLabel?: string;
  renderCreateNew?: (props: { onCreated: (option: ComboboxOption) => void; onCancel: () => void }) => React.ReactNode;
  // Fired whenever the selection changes (pick, clear, or a freshly
  // created record) — for a caller that wants to react immediately
  // instead of waiting for a surrounding <form> to submit.
  onSelect?: (option: ComboboxOption | null) => void;
}) {
  const [allOptions, setAllOptions] = useState(options);
  const [selectedId, setSelectedId] = useState(defaultValue);
  const [query, setQuery] = useState(() => allOptions.find((o) => o.id === defaultValue)?.label ?? "");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selectedOption = allOptions.find((o) => o.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || (selectedOption && query === selectedOption.label)) return allOptions;
    return allOptions.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? "").toLowerCase().includes(q)
    );
  }, [allOptions, query, selectedOption]);

  // The "+ Add new" row (when present) is always the last item in the
  // keyboard-navigable list, one past the filtered options.
  const rowCount = filtered.length + (renderCreateNew ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeAndRevert();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedOption]);

  function closeAndRevert() {
    setOpen(false);
    setQuery(selectedOption?.label ?? "");
  }

  function selectOption(option: ComboboxOption) {
    setSelectedId(option.id);
    setQuery(option.label);
    setOpen(false);
    onSelect?.(option);
  }

  function clearSelection() {
    setSelectedId("");
    setQuery("");
    inputRef.current?.focus();
    setOpen(true);
    onSelect?.(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        setHighlighted(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((prev) => Math.min(prev + 1, rowCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted === filtered.length && renderCreateNew) {
        setCreating(true);
        setOpen(false);
      } else if (filtered[highlighted]) {
        selectOption(filtered[highlighted]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeAndRevert();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={name} value={selectedId} required={required} />
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={query}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setHighlighted(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedId("");
            setOpen(true);
            setHighlighted(0);
          }}
          onKeyDown={handleKeyDown}
          className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-7 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        {selectedId && (
          <button
            type="button"
            onClick={clearSelection}
            aria-label="Clear selection"
            className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div id={listboxId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.length === 0 && !renderCreateNew && <p className="px-3 py-2 text-sm text-slate-400">{emptyMessage}</p>}
          {filtered.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === selectedId}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => selectOption(option)}
              className={`block w-full px-3 py-1.5 text-left text-sm ${
                index === highlighted ? "bg-emerald-50 text-emerald-800" : "text-slate-700"
              }`}
            >
              {option.label}
              {option.sublabel && <span className="ml-1.5 text-xs text-slate-400">{option.sublabel}</span>}
            </button>
          ))}
          {renderCreateNew && (
            <button
              type="button"
              onMouseEnter={() => setHighlighted(filtered.length)}
              onClick={() => {
                setCreating(true);
                setOpen(false);
              }}
              className={`block w-full border-t border-slate-100 px-3 py-1.5 text-left text-sm font-medium text-emerald-700 ${
                highlighted === filtered.length ? "bg-emerald-50" : ""
              }`}
            >
              {createNewLabel}
            </button>
          )}
        </div>
      )}

      {creating && renderCreateNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            {renderCreateNew({
              onCreated: (option) => {
                setAllOptions((prev) => sortAlphabetically([...prev, option], (o) => o.label));
                selectOption(option);
                setCreating(false);
              },
              onCancel: () => setCreating(false),
            })}
          </div>
        </div>
      )}
    </div>
  );
}
