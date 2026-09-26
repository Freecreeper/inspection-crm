"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { trapTabKey } from "./focusTrap";

const WIDE_QUERY = "(min-width: 1024px)";

function useIsWide() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with the real viewport after hydration
    setWide(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}

// A right-side panel. On wide screens it's non-modal — the page behind it
// stays usable, so picking another row just swaps the panel's contents. On
// narrower screens it becomes a full-width modal sheet (backdrop + focus
// trap), since there's no room for the page beside it.
//
// Focus moves to the panel's title when it opens (or when `focusKey`
// changes, e.g. a different record is shown) and returns to whatever had
// focus before on close.
export function Drawer({
  open,
  onClose,
  title,
  titleId,
  focusKey,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  titleId: string;
  focusKey?: string | null;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const isWide = useIsWide();
  const modal = !isWide;

  useEffect(() => {
    if (!open) return;
    // Whatever opened (or re-targeted) the panel from outside it is where
    // focus should land again on close — e.g. the most recently picked row.
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && !panelRef.current?.contains(active)) returnFocusRef.current = active;
    titleRef.current?.focus();
  }, [open, focusKey]);

  useEffect(() => {
    if (open) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target && document.contains(target)) target.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Let an open inner control (a menu, an inline editor) consume
        // Escape first — they stop propagation when they do.
        if (event.defaultPrevented) return;
        onClose();
        return;
      }
      if (modal && panelRef.current) trapTabKey(panelRef.current, event);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, modal, onClose]);

  if (!open) return null;

  return (
    <>
      {modal && <div className="fixed inset-0 z-30 bg-slate-900/30" aria-hidden="true" onClick={onClose} />}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={modal}
        aria-labelledby={titleId}
        className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-slate-200 bg-white shadow-xl sm:max-w-md"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="min-w-0 text-lg font-semibold text-slate-900 focus:outline-none">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-emerald-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
