"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Mail, MoreHorizontal, Phone, Plus } from "lucide-react";
import { telHref } from "@/lib/realtors/display";
import { LogCommunicationForm, QuickTaskForm } from "./QuickForms";

const actionClass =
  "inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600";
const unavailableClass = "inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-200 px-3 py-1.5 text-sm text-slate-400";

// Missing contact info removes only the action that needs it — the rest of
// the record stays fully usable (§7 non-blocking data).
export function QuickActions({
  realtorId,
  phone,
  email,
  canWrite,
  showOpenRecord = false,
  onChanged,
  onCustomize,
}: {
  realtorId: string;
  phone: string | null;
  email: string | null;
  canWrite: boolean;
  showOpenRecord?: boolean;
  onChanged: () => void;
  // Present only where the card is customizable (the preview drawer).
  onCustomize?: () => void;
}) {
  const [panel, setPanel] = useState<"task" | "log" | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {phone ? (
          <a href={telHref(phone)} className={actionClass}>
            <Phone className="h-4 w-4" aria-hidden="true" />
            Call
          </a>
        ) : (
          <span className={unavailableClass}>
            <Phone className="h-4 w-4" aria-hidden="true" />
            Phone not provided
          </span>
        )}
        {email ? (
          <a href={`mailto:${email}`} className={actionClass}>
            <Mail className="h-4 w-4" aria-hidden="true" />
            Email
          </a>
        ) : (
          <span className={unavailableClass}>
            <Mail className="h-4 w-4" aria-hidden="true" />
            Email not provided
          </span>
        )}
        {canWrite && (
          <button type="button" onClick={() => setPanel(panel === "task" ? null : "task")} aria-expanded={panel === "task"} className={actionClass}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Task
          </button>
        )}
        <MoreMenu
          items={[
            ...(canWrite ? [{ label: "Log call or email", onSelect: () => setPanel("log") }] : []),
            ...(canWrite ? [{ label: "New transaction", href: `/transactions/new?realtorId=${realtorId}` }] : []),
            ...(showOpenRecord ? [{ label: "Open full record", href: `/realtors/${realtorId}` }] : []),
            { label: "Relationship analytics", href: `/realtors/${realtorId}/analytics` },
            ...(onCustomize ? [{ label: "Customize card", onSelect: onCustomize }] : []),
          ]}
        />
      </div>
      {panel === "task" && (
        <QuickTaskForm
          realtorId={realtorId}
          onCancel={() => setPanel(null)}
          onDone={() => {
            setPanel(null);
            onChanged();
          }}
        />
      )}
      {panel === "log" && (
        <LogCommunicationForm
          realtorId={realtorId}
          onCancel={() => setPanel(null)}
          onDone={() => {
            setPanel(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

type MenuItem = { label: string; href?: string; onSelect?: () => void };

function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    containerRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const entries = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = entries.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      entries[(index + 1) % entries.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      entries[(index - 1 + entries.length) % entries.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const itemClass = "block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none";

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="More actions"
        onClick={() => setOpen((v) => !v)}
        className={actionClass}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} role="menu" onKeyDown={onMenuKeyDown} className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {items.map((item) =>
            item.href ? (
              <Link key={item.label} href={item.href} role="menuitem" className={itemClass} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={itemClass}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
