"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";

// The menu height is fixed-ish (up to 4 items) — used only to decide
// open-up-vs-down against the viewport, not to size anything.
const ESTIMATED_MENU_HEIGHT = 165;

export function RealtorActionsMenu({
  realtorId,
  email,
  phone,
}: {
  realtorId: string;
  email: string | null;
  phone: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
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
    if (!open && containerRef.current) {
      const { bottom } = containerRef.current.getBoundingClientRect();
      setOpenUpward(window.innerHeight - bottom < ESTIMATED_MENU_HEIGHT);
    }
    setOpen((prev) => !prev);
  }

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={toggleOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute right-0 z-10 w-44 rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg ${
            openUpward ? "bottom-full mb-1" : "mt-1"
          }`}
        >
          <Link
            href={`/realtors/${realtorId}`}
            role="menuitem"
            className="block px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            View profile
          </Link>
          {email && (
            <a href={`mailto:${email}`} role="menuitem" className="block px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              Email
            </a>
          )}
          {phone && (
            <a href={`tel:${phone}`} role="menuitem" className="block px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              Call
            </a>
          )}
          {phone && (
            <a href={`sms:${phone}`} role="menuitem" className="block px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              Text
            </a>
          )}
        </div>
      )}
    </div>
  );
}
