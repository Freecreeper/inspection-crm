"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

// A column header that's also the sort control — click to sort ascending
// by this column, click again to flip to descending. Reads/writes
// sortBy/sortDir via the URL (client-side router.push, same reasoning as
// RealtorFilterBar: a native form/link here would be a full page load and
// bring back the sidebar-flash bug that fix was for), preserving every
// other current query param (q, brokerageId) via useSearchParams so
// changing sort never resets the active search or filter.
export function SortableColumnHeader({
  label,
  sortKey,
  currentSortBy,
  currentSortDir,
  align = "left",
}: {
  label: string;
  sortKey: string;
  currentSortBy: string;
  currentSortDir: "asc" | "desc";
  align?: "left" | "right";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isActive = currentSortBy === sortKey;

  function handleClick() {
    const nextDir = isActive && currentSortDir === "asc" ? "desc" : "asc";
    const params = new URLSearchParams(searchParams.toString());
    params.set("sortBy", sortKey);
    params.set("sortDir", nextDir);
    router.push(`/realtors?${params.toString()}`);
  }

  const Icon = isActive ? (currentSortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    // aria-sort belongs on the <th> (role columnheader), not this button —
    // the parent page sets it on the actual <th> this renders inside.
    <button
      type="button"
      onClick={handleClick}
      className={`flex items-center gap-1 font-medium hover:text-slate-700 ${align === "right" ? "ml-auto flex-row-reverse" : ""}`}
    >
      {label}
      <Icon className={`h-3.5 w-3.5 ${isActive ? "text-slate-600" : "text-slate-300"}`} />
    </button>
  );
}
