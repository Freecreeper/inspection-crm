"use client";

import { useId, useState, useTransition } from "react";
import { Modal } from "@/components/Modal";
import { formatDay, formatDuration, formatTime, formatTimeRange, zonedDateTimeToUtc } from "@/lib/calendar/time";
import type { SerializedConflict } from "@/lib/scheduling/service";
import { cancelInspectionAction, createBlockedTime, createCalendarTask, rescheduleInspectionAction, type SchedulingOptions } from "../actions";
import { ConflictNotice, DurationSelect, input, labelClass, useConflictPreview } from "./ScheduleDialog";

export interface RescheduleTarget {
  inspectionId: string;
  address: string;
  day: string;
  time: string;
  durationMinutes: number;
  inspectorId: string | null;
}

// A drag, or the Reschedule button, lands here: nothing changes until the
// user confirms, and the confirmation says exactly what will happen.
export function RescheduleDialog({
  target,
  proposed,
  options,
  timeZone,
  onClose,
  onDone,
}: {
  target: RescheduleTarget;
  proposed: { day: string; time: string } | null;
  options: SchedulingOptions;
  timeZone: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const [day, setDay] = useState(proposed?.day ?? target.day);
  const [time, setTime] = useState(proposed?.time ?? target.time);
  const [durationMinutes, setDuration] = useState(target.durationMinutes);
  const [inspectorId, setInspectorId] = useState(target.inspectorId ?? "");
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverConflicts, setServerConflicts] = useState<SerializedConflict[] | null>(null);
  const [pending, startTransition] = useTransition();

  const preview = useConflictPreview({ inspectorId: inspectorId || null, day, time, durationMinutes, excludeInspectionId: target.inspectionId });
  const conflicts = serverConflicts ?? preview;
  const inspectorName = options.inspectors.find((i) => i.id === inspectorId)?.name ?? null;
  const oldStart = zonedDateTimeToUtc(target.day, target.time, timeZone);
  const oldEnd = new Date(oldStart.getTime() + target.durationMinutes * 60_000);
  const validNew = /^\d{4}-\d{2}-\d{2}$/.test(day) && /^\d{2}:\d{2}$/.test(time);
  const newStart = validNew ? zonedDateTimeToUtc(day, time, timeZone) : null;
  const newEnd = newStart ? new Date(newStart.getTime() + durationMinutes * 60_000) : null;
  const timeChanged = !newStart || newStart.getTime() !== oldStart.getTime();

  function confirm() {
    setError(null);
    setServerConflicts(null);
    startTransition(async () => {
      try {
        const result = await rescheduleInspectionAction(target.inspectionId, { day, time, durationMinutes, inspectorId: inspectorId || null, notify });
        if (result.ok) return onDone();
        if ("conflicts" in result) setServerConflicts(result.conflicts);
        setError(result.error);
      } catch {
        setError("Couldn't reschedule. You may not have permission.");
      }
    });
  }

  return (
    <Modal open onClose={onClose} title="Reschedule inspection?" titleId={`${id}-title`}>
      <div className="space-y-4">
        <p className="font-medium text-slate-900">{target.address}</p>
        <dl className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Old</dt>
            <dd className="mt-0.5 text-slate-700">
              {formatDay(target.day, "short")}
              <span className="block">{formatTimeRange(oldStart, oldEnd, timeZone)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">New</dt>
            <dd className="mt-0.5 font-medium text-slate-900">
              {validNew ? formatDay(day, "short") : "—"}
              <span className="block">{newStart && newEnd ? formatTimeRange(newStart, newEnd, timeZone) : "—"}</span>
            </dd>
          </div>
        </dl>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-day`} className={labelClass}>
              Date
            </label>
            <input id={`${id}-day`} type="date" value={day} onChange={(e) => setDay(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor={`${id}-time`} className={labelClass}>
              Time
            </label>
            <input id={`${id}-time`} type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor={`${id}-duration`} className={labelClass}>
              Duration
            </label>
            <DurationSelect id={`${id}-duration`} value={durationMinutes} onChange={setDuration} />
          </div>
          <div>
            <label htmlFor={`${id}-inspector`} className={labelClass}>
              Inspector
            </label>
            <select id={`${id}-inspector`} value={inspectorId} onChange={(e) => setInspectorId(e.target.value)} className={input}>
              <option value="">Not assigned</option>
              {options.inspectors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {timeChanged && (
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5" />
            <span>
              Notify the customer and realtor
              <span className="block text-xs text-slate-500">
                Prepared or sent according to the appointment-change automation (it may be set to review first, or off). The reminder is re-created for the new time either way, and the old one can never send.
              </span>
            </span>
          </label>
        )}

        <ConflictNotice
          conflicts={conflicts}
          inspectorName={inspectorName}
          timeZone={timeZone}
          proposed={newStart && newEnd ? `${target.address}, ${formatTimeRange(newStart, newEnd, timeZone)} (${formatDuration(durationMinutes)})` : null}
        />
        {error && !conflicts.length && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            {conflicts.length ? "Choose another time" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending || conflicts.length > 0 || !validNew}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Confirm reschedule"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function CancelDialog({
  inspectionId,
  address,
  when,
  onClose,
  onDone,
}: {
  inspectionId: string;
  address: string;
  when: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Modal open onClose={onClose} title="Cancel inspection?" titleId={`${id}-title`}>
      <div className="space-y-4">
        <p className="text-sm text-slate-700">
          <span className="font-medium text-slate-900">{address}</span>
          <span className="block">{when}</span>
        </p>
        <p className="text-xs text-slate-500">The inspection stays in the record as cancelled. Pending reminders are withdrawn.</p>
        <div>
          <label htmlFor={`${id}-reason`} className={labelClass}>
            Reason <span className="font-normal text-slate-400">(optional, internal)</span>
          </label>
          <textarea id={`${id}-reason`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5" />
          <span>
            Notify the customer and realtor
            <span className="block text-xs text-slate-500">According to the appointment-change automation settings.</span>
          </span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Keep inspection
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  const result = await cancelInspectionAction(inspectionId, { notify, reason });
                  if (!result.ok) return setError(result.error);
                  onDone();
                } catch {
                  setError("Couldn't cancel. You may not have permission.");
                }
              })
            }
            className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {pending ? "Cancelling…" : "Cancel inspection"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function BlockTimeDialog({
  initialDay,
  initialTime,
  people,
  lockedUserId,
  onClose,
  onDone,
}: {
  initialDay: string;
  initialTime: string;
  people: { id: string; name: string }[];
  // Inspectors may only block their own time.
  lockedUserId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const [userId, setUserId] = useState(lockedUserId ?? people[0]?.id ?? "");
  const [title, setTitle] = useState("Unavailable");
  const [day, setDay] = useState(initialDay);
  const [startTime, setStart] = useState(initialTime);
  const [endTime, setEnd] = useState(() => {
    const [h, m] = initialTime.split(":").map(Number);
    return `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Modal open onClose={onClose} title="Block time" titleId={`${id}-title`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            setError(null);
            try {
              const result = await createBlockedTime({ userId, title, day, startTime, endTime });
              if (!result.ok) return setError(result.error);
              onDone();
            } catch {
              setError("Couldn't block this time. You may not have permission.");
            }
          });
        }}
      >
        <p className="text-xs text-slate-500">Vacation, office meeting, personal time. An inspector&apos;s blocked time counts as a scheduling conflict.</p>
        <div>
          <label htmlFor={`${id}-who`} className={labelClass}>
            Whose time
          </label>
          <select id={`${id}-who`} value={userId} disabled={Boolean(lockedUserId)} onChange={(e) => setUserId(e.target.value)} className={input}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-label`} className={labelClass}>
            Label
          </label>
          <input id={`${id}-label`} required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor={`${id}-day`} className={labelClass}>
              Date
            </label>
            <input id={`${id}-day`} type="date" required value={day} onChange={(e) => setDay(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor={`${id}-start`} className={labelClass}>
              From
            </label>
            <input id={`${id}-start`} type="time" step={900} required value={startTime} onChange={(e) => setStart(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor={`${id}-end`} className={labelClass}>
              To
            </label>
            <input id={`${id}-end`} type="time" step={900} required value={endTime} onChange={(e) => setEnd(e.target.value)} className={input} />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
            {pending ? "Saving…" : "Block time"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AddTaskDialog({ initialDay, people, onClose, onDone }: { initialDay: string; people: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(initialDay);
  const [assigneeId, setAssigneeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Modal open onClose={onClose} title="Add task" titleId={`${id}-title`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            setError(null);
            try {
              const result = await createCalendarTask({ title, day, assigneeId: assigneeId || null });
              if (!result.ok) return setError(result.error);
              onDone();
            } catch {
              setError("Couldn't add the task. You may not have permission.");
            }
          });
        }}
      >
        <div>
          <label htmlFor={`${id}-title-input`} className={labelClass}>
            Task
          </label>
          <input id={`${id}-title-input`} required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Confirm utilities are on" className={input} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-day`} className={labelClass}>
              Due
            </label>
            <input id={`${id}-day`} type="date" required value={day} onChange={(e) => setDay(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor={`${id}-assignee`} className={labelClass}>
              Assignee
            </label>
            <select id={`${id}-assignee`} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={input}>
              <option value="">Unassigned</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
            {pending ? "Saving…" : "Add task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function whenLabel(day: string | null, start: string | null, timeZone: string) {
  if (!day || !start) return "Not scheduled";
  return `${formatDay(day, "long")} at ${formatTime(new Date(start), timeZone)}`;
}
