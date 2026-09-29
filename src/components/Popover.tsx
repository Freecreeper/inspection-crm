"use client";

import { useEffect, useId, useRef, useState } from "react";

// A labelled button with a panel beneath it (a menu or a small form).
// Escape or a click outside closes it and returns focus to the button.
export function Popover({
  label,
  buttonClassName,
  align = "right",
  children,
}: {
  label: React.ReactNode;
  buttonClassName: string;
  align?: "left" | "right";
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const buttonId = useId();

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>("[data-autofocus], button, input")?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    document.getElementById(buttonId)?.focus();
  };

  return (
    <div ref={ref} className="relative">
      <button ref={buttonRef} id={buttonId} type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)} className={buttonClassName}>
        {label}
      </button>
      {open && (
        <div id={panelId} className={`absolute z-30 mt-1 min-w-52 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>
          {children(close)}
        </div>
      )}
    </div>
  );
}
