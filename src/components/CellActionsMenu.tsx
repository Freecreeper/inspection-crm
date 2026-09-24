"use client";

import { useEffect, useRef, useState } from "react";

export type CellAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

const ESTIMATED_ITEM_HEIGHT = 34;

// A small stacked-actions popup anchored under a table cell. Cells no
// longer edit inline on first click — clicking opens this menu instead,
// and "Edit" (appended by the caller alongside the cell's other actions,
// e.g. Call/Text/Email) is what actually flips the cell into its edit
// state. Positioning/click-outside/Escape handling mirrors
// RealtorActionsMenu, just left-aligned under the cell instead of
// right-aligned under a corner button.
export function CellActionsMenu({
  trigger,
  actions,
  disabled = false,
}: {
  trigger: React.ReactNode;
  actions: CellAction[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggleOpen() {
    if (disabled) return;
    if (!open && containerRef.current) {
      const { bottom } = containerRef.current.getBoundingClientRect();
      setOpenUpward(window.innerHeight - bottom < actions.length * ESTIMATED_ITEM_HEIGHT + 16);
    }
    setOpen((prev) => !prev);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className="block w-full rounded px-1 py-0.5 text-left hover:enabled:bg-slate-100"
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute left-0 z-20 w-40 rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg ${
            openUpward ? "bottom-full mb-1" : "mt-1"
          }`}
        >
          {actions.map((action) =>
            action.href ? (
              <a
                key={action.label}
                href={action.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                {action.label}
              </a>
            ) : (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  action.onClick?.();
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                {action.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
