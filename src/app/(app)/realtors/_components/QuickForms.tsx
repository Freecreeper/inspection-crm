"use client";

import { useId, useState, useTransition } from "react";
import { createRealtorTask, logRealtorCommunication } from "../actions";
import { COMMUNICATION_CHANNELS } from "@/lib/communications";
import { addDays, toDateInputValue } from "@/lib/dates";

const input = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const primary = "rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60";
const secondary = "rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100";

function stopEscape(onCancel: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };
}

export function QuickTaskForm({ realtorId, onDone, onCancel }: { realtorId: string; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("Follow up");
  const [dueDate, setDueDate] = useState(toDateInputValue(addDays(new Date(), 7)));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createRealtorTask(realtorId, { title, dueDate });
      if (result.ok) onDone();
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} onKeyDown={stopEscape(onCancel)} className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3" aria-label="New follow-up task">
      <div>
        <label htmlFor={`${id}-title`} className="text-xs text-slate-600">
          Task
        </label>
        <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus className={input} />
      </div>
      <div>
        <label htmlFor={`${id}-due`} className="text-xs text-slate-600">
          Due date (optional)
        </label>
        <input id={`${id}-due`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input} />
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Adding…" : "Add task"}
        </button>
        <button type="button" onClick={onCancel} className={secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function LogCommunicationForm({ realtorId, onDone, onCancel }: { realtorId: string; onDone: () => void; onCancel: () => void }) {
  const [channel, setChannel] = useState<string>("Phone");
  const [direction, setDirection] = useState("OUTBOUND");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await logRealtorCommunication(realtorId, { channel, direction, summary });
      if (result.ok) onDone();
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} onKeyDown={stopEscape(onCancel)} className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3" aria-label="Log a communication">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${id}-channel`} className="text-xs text-slate-600">
            Channel
          </label>
          <select id={`${id}-channel`} value={channel} onChange={(e) => setChannel(e.target.value)} className={input}>
            {COMMUNICATION_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-direction`} className="text-xs text-slate-600">
            Direction
          </label>
          <select id={`${id}-direction`} value={direction} onChange={(e) => setDirection(e.target.value)} className={input}>
            <option value="OUTBOUND">Outbound</option>
            <option value="INBOUND">Inbound</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-summary`} className="text-xs text-slate-600">
          Summary
        </label>
        <textarea id={`${id}-summary`} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} required autoFocus className={input} />
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving…" : "Log it"}
        </button>
        <button type="button" onClick={onCancel} className={secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}
