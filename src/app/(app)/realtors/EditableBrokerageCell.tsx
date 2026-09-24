"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Building2 } from "lucide-react";
import { BrokerageCombobox } from "./BrokerageCombobox";
import type { ComboboxOption } from "@/components/Combobox";
import { CellActionsMenu, type CellAction } from "@/components/CellActionsMenu";

// changeRealtorBrokerage requires a non-empty brokerageId (it's "move to
// a new brokerage", not "unset" — see src/app/(app)/realtors/actions.ts),
// so clearing the combobox without picking a replacement just cancels
// back to display mode rather than attempting to save an empty value.
// Clicking the displayed brokerage opens a stacked-actions popup
// (Call/Text/Email/Template Email plus "Edit") rather than editing
// directly.
export function EditableBrokerageCell({
  currentName,
  options,
  onSelectBrokerage,
  actions,
}: {
  currentName: string | null;
  options: ComboboxOption[];
  onSelectBrokerage: (brokerageId: string) => Promise<void>;
  actions: CellAction[];
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  // Combobox handles its own dropdown's click-outside (it just closes the
  // dropdown, not this whole cell) — this is the escape hatch back to
  // display mode for a click anywhere else, since nothing here is a
  // <form> a blur/Escape could hook into.
  useEffect(() => {
    if (!editing) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setEditing(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [editing]);

  if (!editing) {
    return (
      <CellActionsMenu
        trigger={
          currentName ? (
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100">
                <Building2 className="h-3.5 w-3.5 text-slate-500" />
              </div>
              <span className="truncate text-slate-700">{currentName}</span>
            </div>
          ) : (
            <span className="text-slate-400">Not provided</span>
          )
        }
        actions={[...actions, { label: "Edit", onClick: () => setEditing(true) }]}
      />
    );
  }

  return (
    <div ref={containerRef}>
      <BrokerageCombobox
        name="brokerageId"
        options={options}
        onSelect={(option) => {
          if (!option) {
            setEditing(false);
            return;
          }
          setError(null);
          startTransition(async () => {
            try {
              await onSelectBrokerage(option.id);
              setEditing(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save.");
            }
          });
        }}
      />
      {pending && <p className="mt-0.5 text-xs text-slate-400">Saving…</p>}
      {error && <p className="mt-0.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
