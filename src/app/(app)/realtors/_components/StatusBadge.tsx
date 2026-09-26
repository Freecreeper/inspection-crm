// Status is always spelled out in text; the dot is decoration, never the
// only signal.
export function StatusBadge({ active, followUpOverdue = false }: { active: boolean; followUpOverdue?: boolean }) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
        <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden="true" />
        {active ? "Active" : "Inactive"}
      </span>
      {followUpOverdue && <span className="text-xs font-medium text-amber-700">Follow-up overdue</span>}
    </span>
  );
}
