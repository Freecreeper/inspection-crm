import { formatShortDate } from "@/lib/dates";
import { followUpBucket } from "@/lib/realtors/followUp";

// When the next open follow-up is due, spelled out in words so overdue
// never relies on color alone.
export function NextActionLabel({ dueAt, hasOpenTask }: { dueAt: string | null; hasOpenTask: boolean }) {
  if (!dueAt) {
    return hasOpenTask ? <span className="text-slate-600">No due date</span> : <span className="text-slate-400">None</span>;
  }
  const bucket = followUpBucket(new Date(dueAt), new Date());
  if (bucket === "overdue") return <span className="font-medium text-amber-700">Overdue · {formatShortDate(dueAt)}</span>;
  if (bucket === "today") return <span className="font-medium text-slate-900">Today</span>;
  return <span className="text-slate-700">{formatShortDate(dueAt)}</span>;
}
