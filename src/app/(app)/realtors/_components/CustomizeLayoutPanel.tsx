"use client";

import { useEffect, useId, useRef } from "react";
import { DEFAULT_DIRECTORY_LAYOUT, DIRECTORY_COLUMNS } from "@/lib/realtors/directoryLayout";
import { useDirectoryLayout } from "./DirectoryLayoutContext";

// Which columns the directory shows, and how tall its rows are. Saved to
// the user's account; the Realtor name column is always shown.
export function CustomizeLayoutPanel({ onClose }: { onClose: () => void }) {
  const { layout, update, saving, error } = useDirectoryLayout();
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Mount-only: focus the first enabled option and listen for outside clicks.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLInputElement>("input:not([disabled])")?.focus();
    function onPointerDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onCloseRef.current();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={headingId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute right-0 top-full z-20 mt-1 w-72 space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
    >
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={headingId} className="text-sm font-medium text-slate-900">
            Customize layout
          </h2>
          {saving && <span className="text-xs text-slate-500">Saving…</span>}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">Saved to your account.</p>
      </div>

      <fieldset>
        <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">Columns</legend>
        <ul className="mt-2 space-y-1.5">
          <li>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked disabled />
              Realtor <span className="text-xs">(always shown)</span>
            </label>
          </li>
          {DIRECTORY_COLUMNS.map((column) => (
            <li key={column.key}>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={layout.columns.includes(column.key)}
                  onChange={(e) =>
                    update({
                      ...layout,
                      columns: DIRECTORY_COLUMNS.map((c) => c.key).filter((k) =>
                        k === column.key ? e.target.checked : layout.columns.includes(k)
                      ),
                    })
                  }
                />
                {column.label}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset>
        <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">Row density</legend>
        <div className="mt-2 flex gap-4 text-sm text-slate-700">
          {(["comfortable", "compact"] as const).map((density) => (
            <label key={density} className="flex items-center gap-1.5">
              <input type="radio" name={`${headingId}-density`} checked={layout.density === density} onChange={() => update({ ...layout, density })} />
              {density === "comfortable" ? "Comfortable" : "Compact"}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
          Done
        </button>
        <button
          type="button"
          onClick={() => update(DEFAULT_DIRECTORY_LAYOUT)}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
        >
          Reset to default
        </button>
      </div>
    </div>
  );
}
