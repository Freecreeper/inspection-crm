"use client";

import { useId, useState, useTransition } from "react";
import { completeTask, rescheduleTask } from "../../tasks/actions";
import { toDateInputValue } from "@/lib/dates";

// Complete / Reschedule for one existing Task — shared by the preview
// drawer, the Follow-up queue, and the record's Overview. Both go through
// the ordinary Task actions; there is no Realtor-specific task path.
export function TaskActions({
  taskId,
  dueAt,
  onDone,
  size = "sm",
}: {
  taskId: string;
  dueAt: string | null;
  onDone?: () => void;
  size?: "sm" | "xs";
}) {
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState(toDateInputValue(dueAt ? new Date(dueAt) : null));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dateId = useId();

  const button =
    size === "xs"
      ? "rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      : "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

  function complete() {
    setError(null);
    startTransition(async () => {
      try {
        await completeTask(taskId);
        onDone?.();
      } catch {
        setError("Couldn't complete this task. You may not have permission.");
      }
    });
  }

  function saveDate() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await rescheduleTask(taskId, date);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setRescheduling(false);
        onDone?.();
      } catch {
        setError("Couldn't reschedule this task. You may not have permission.");
      }
    });
  }

  return (
    <div className="space-y-2">
      {rescheduling ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={dateId} className="sr-only">
            New due date
          </label>
          <input
            id={dateId}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setRescheduling(false);
              }
            }}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          <button type="button" onClick={saveDate} disabled={pending || !date} className={button}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setRescheduling(false)} disabled={pending} className="px-1 text-xs text-slate-500 hover:underline">
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={complete} disabled={pending} className={button}>
            {pending ? "Saving…" : "Complete"}
          </button>
          <button type="button" onClick={() => setRescheduling(true)} disabled={pending} className={button}>
            Reschedule
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
