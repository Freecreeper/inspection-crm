"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Circle, Minus, Phone } from "lucide-react";
import { Drawer } from "@/components/Drawer";
import { EmailButton } from "@/components/email/EmailComposer";
import { formatPhone } from "@/lib/phone";
import { telHref } from "@/lib/realtors/display";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { InspectionPreview, RealtorEventPreview, TaskPreview } from "@/lib/calendar/preview";
import type { ChecklistItem } from "@/lib/calendar/readiness";
import { formatDay, formatDuration, formatTimeRange } from "@/lib/calendar/time";
import { completeTask, rescheduleTask } from "../../tasks/actions";
import { getInspectionPreview, getRealtorEventPreview, getTaskPreview, removeBlockedTime, setAgreementSigned } from "../actions";
import { EVENT_KIND, EventIcon } from "./eventStyle";

export interface Viewer {
  userId: string | null;
  role: string | null;
  canSchedule: boolean;
  canReschedule: boolean;
  canCancel: boolean;
  canBlockTime: boolean;
  canUpdateTasks: boolean;
  canEmail: boolean;
}

const actionClass =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-60";
const primaryClass = "inline-flex items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800";
const heading = "text-xs font-medium uppercase tracking-wide text-slate-500";
const notProvided = <span className="text-slate-400">Not provided</span>;

// SCAN → PREVIEW → ACT → OPEN FULL RECORD: opening an event shows what's
// most likely needed and the next actions, without leaving the Calendar.
export function PreviewDrawer({
  event,
  timeZone,
  viewer,
  onClose,
  onChanged,
  onReschedule,
  onCancel,
}: {
  event: CalendarEvent | null;
  timeZone: string;
  viewer: Viewer;
  onClose: () => void;
  onChanged: () => void;
  onReschedule: (preview: InspectionPreview) => void;
  onCancel: (preview: InspectionPreview) => void;
}) {
  const title = event ? (event.type === "inspection" ? event.title : EVENT_KIND[event.type].label) : "";
  return (
    <Drawer open={event !== null} onClose={onClose} title={title} titleId="calendar-preview-title" focusKey={event?.id ?? null}>
      {event?.type === "inspection" && <InspectionBody key={event.id} event={event} timeZone={timeZone} onChanged={onChanged} onReschedule={onReschedule} onCancel={onCancel} />}
      {(event?.type === "task" || event?.type === "realtorFollowUp") && <TaskBody key={event.id} event={event} viewer={viewer} onChanged={onChanged} onClose={onClose} />}
      {(event?.type === "birthday" || event?.type === "careerAnniversary" || event?.type === "relationshipAnniversary") && <RealtorOccasionBody key={event.id} event={event} />}
      {event && !["inspection", "task", "realtorFollowUp", "birthday", "careerAnniversary", "relationshipAnniversary"].includes(event.type) && (
        <GenericBody key={event.id} event={event} timeZone={timeZone} viewer={viewer} onChanged={onChanged} onClose={onClose} />
      )}
    </Drawer>
  );
}

function useLoad<T>(load: () => Promise<T | null>) {
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; data: T } | { status: "missing" } | { status: "error" }>({ status: "loading" });
  const request = useRef(0);
  const run = useCallback(async () => {
    const r = ++request.current;
    try {
      const data = await load();
      if (r === request.current) setState(data ? { status: "ready", data } : { status: "missing" });
    } catch {
      if (r === request.current) setState({ status: "error" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open; state is set after an await
    run();
  }, [run]);
  return [state, run] as const;
}

function Status({ state }: { state: { status: string } }) {
  if (state.status === "loading")
    return (
      <div className="space-y-3 p-5" aria-hidden="true">
        <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
        <div className="h-16 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
      </div>
    );
  if (state.status === "missing") return <p className="p-5 text-sm text-slate-500">This record no longer exists.</p>;
  return <p className="p-5 text-sm text-red-600">Couldn&apos;t load this. Try again.</p>;
}

function CheckIcon({ item }: { item: ChecklistItem }) {
  if (item.state === "done") return <Check className="h-4 w-4 text-emerald-600" aria-label="Done" />;
  if (item.state === "warn") return <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Needs attention" />;
  if (item.state === "na") return <Minus className="h-4 w-4 text-slate-300" aria-label="Not applicable" />;
  return <Circle className="h-4 w-4 text-slate-300" aria-label="Not yet" />;
}

function InspectionBody({
  event,
  timeZone,
  onChanged,
  onReschedule,
  onCancel,
}: {
  event: CalendarEvent;
  timeZone: string;
  onChanged: () => void;
  onReschedule: (p: InspectionPreview) => void;
  onCancel: (p: InspectionPreview) => void;
}) {
  const [state, reload] = useLoad(() => getInspectionPreview(event.sourceId));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (state.status !== "ready") return <Status state={state} />;
  const p = state.data;

  function toggleAgreement(signed: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setAgreementSigned(p.id, signed).catch(() => ({ ok: false as const, error: "You may not have permission to do that." }));
      if (!result.ok) return setError(result.error);
      await reload();
      onChanged();
    });
  }

  return (
    <div className="divide-y divide-slate-100">
      <section className="space-y-1 px-5 py-4" aria-label="When and what">
        <p className="text-sm text-slate-600">{p.cityLine}</p>
        {p.day && p.start && p.end ? (
          <p className="text-sm font-medium text-slate-900">
            {formatDay(p.day, "long")}
            <span className="block font-normal text-slate-700">
              {formatTimeRange(new Date(p.start), new Date(p.end), timeZone)} · {formatDuration(p.durationMinutes)}
            </span>
          </p>
        ) : (
          <p className="text-sm text-slate-500">Not scheduled yet</p>
        )}
        <p className="text-sm text-slate-700">{p.services.length ? p.services.join(" + ") : <span className="text-amber-700">No services selected</span>}</p>
        {p.status !== "SCHEDULED" && <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{p.status.replace("_", " ").toLowerCase()}</p>}
      </section>

      {p.warnings.length > 0 && (
        <section className="px-5 py-3" aria-label="Warnings">
          <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {p.warnings.map((w) => (
              <li key={w.code} className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {w.label}
              </li>
            ))}
            {p.conflicts.map((c) => (
              <li key={c.start + c.title} className="pl-6 text-xs text-amber-800">
                Overlaps {c.kind === "block" ? "blocked time" : "inspection"}: {c.title}, {formatTimeRange(new Date(c.start), new Date(c.end), timeZone)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 px-5 py-4 text-sm sm:grid-cols-2" aria-label="People">
        <div>
          <h3 className={heading}>Customer</h3>
          {p.customer ? (
            <div className="mt-1">
              <Link href={`/customers/${p.customer.id}`} className="font-medium text-slate-900 hover:underline">
                {p.customer.name}
              </Link>
              <p className="text-slate-600">{p.customer.phone ? formatPhone(p.customer.phone) : <span className="text-slate-400">Phone not provided</span>}</p>
              <p className="truncate text-slate-600">{p.customer.email ?? <span className="text-slate-400">Email not provided</span>}</p>
              {p.otherCustomers > 0 && <p className="text-xs text-slate-500">+{p.otherCustomers} more on the transaction</p>}
            </div>
          ) : (
            <p className="mt-1">{notProvided}</p>
          )}
        </div>
        <div>
          <h3 className={heading}>Realtor</h3>
          {p.realtors.length ? (
            <ul className="mt-1 space-y-1.5">
              {p.realtors.map((r) => (
                <li key={r.id + r.role}>
                  <Link href={`/realtors/${r.id}`} className="font-medium text-slate-900 hover:underline">
                    {r.name}
                  </Link>
                  <p className="text-slate-600">{[r.brokerage, r.role].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">{notProvided}</p>
          )}
        </div>
        <div>
          <h3 className={heading}>Inspector</h3>
          <p className="mt-1">{p.inspector?.name ?? <span className="text-amber-700">Not assigned</span>}</p>
        </div>
        {p.accessNotes && (
          <div>
            <h3 className={heading}>Access</h3>
            <p className="mt-1 whitespace-pre-line text-slate-700">{p.accessNotes}</p>
          </div>
        )}
      </section>

      <section className="px-5 py-4" aria-labelledby="readiness-heading">
        <h3 id="readiness-heading" className={heading}>
          Readiness
        </h3>
        <ul className="mt-2 space-y-1.5 text-sm">
          {p.checklist.map((item) => (
            <li key={item.key} className="flex items-center gap-2">
              <CheckIcon item={item} />
              <span className={item.state === "warn" ? "text-amber-900" : "text-slate-700"}>{item.label}</span>
              {item.key === "agreement" && p.permissions.canEditAgreement && p.status !== "CANCELLED" && (
                <button type="button" disabled={pending} onClick={() => toggleAgreement(!p.agreementSignedAt)} className="ml-auto text-xs font-medium text-emerald-700 hover:underline disabled:opacity-60">
                  {p.agreementSignedAt ? "Undo" : "Mark signed"}
                </button>
              )}
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="mt-2 text-xs text-red-600">
            {error}
          </p>
        )}
      </section>

      <section className="space-y-2 px-5 py-4" aria-label="Actions">
        <div className="flex flex-wrap gap-2">
          {p.customer?.phone ? (
            <a href={telHref(p.customer.phone)} className={actionClass}>
              <Phone className="h-4 w-4" aria-hidden="true" />
              Call customer
            </a>
          ) : null}
          {p.permissions.canEmail && <EmailButton context={{ kind: "inspection", id: p.id }} className={actionClass} onChanged={onChanged} />}
          {p.permissions.canReschedule && (
            <button type="button" onClick={() => onReschedule(p)} className={actionClass}>
              Reschedule
            </button>
          )}
          {p.permissions.canCancel && (
            <button type="button" onClick={() => onCancel(p)} className={`${actionClass} text-red-700`}>
              Cancel inspection
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
          <Link href={`/transactions/${p.transactionId}`} className="text-emerald-700 hover:underline">
            Open transaction
          </Link>
          {p.reportId && (
            <Link href={`/inspections/${p.id}/report`} className="text-emerald-700 hover:underline">
              Open report
            </Link>
          )}
        </div>
        <Link href={`/inspections/${p.id}`} className={`${primaryClass} mt-2 w-full`}>
          Open inspection
        </Link>
      </section>
    </div>
  );
}

function TaskBody({ event, viewer, onChanged, onClose }: { event: CalendarEvent; viewer: Viewer; onChanged: () => void; onClose: () => void }) {
  const [state] = useLoad<TaskPreview>(() => getTaskPreview(event.sourceId));
  const [pending, startTransition] = useTransition();
  const [newDay, setNewDay] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (state.status !== "ready") return <Status state={state} />;
  const t = state.data;

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = (await fn()) as { ok?: boolean; error?: string } | undefined;
        if (result && result.ok === false) return setError(result.error ?? "Couldn't do that.");
        onChanged();
        onClose();
      } catch {
        setError("You may not have permission to do that.");
      }
    });

  return (
    <div className="divide-y divide-slate-100">
      <section className="space-y-1 px-5 py-4">
        <p className="font-medium text-slate-900">{t.title}</p>
        {t.day && <p className="text-sm text-slate-600">Due {formatDay(t.day, "long")}</p>}
        {t.assignee && <p className="text-sm text-slate-600">Assigned to {t.assignee}</p>}
        {t.description && <p className="whitespace-pre-line text-sm text-slate-700">{t.description}</p>}
      </section>
      {t.realtor && (
        <section className="space-y-2 px-5 py-4 text-sm">
          <h3 className={heading}>Realtor</h3>
          <div>
            <Link href={`/realtors/${t.realtor.id}`} className="font-medium text-slate-900 hover:underline">
              {t.realtor.name}
            </Link>
            <p className="text-slate-600">{t.realtor.brokerage ?? "No brokerage"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {t.realtor.phone && (
              <a href={telHref(t.realtor.phone)} className={actionClass}>
                <Phone className="h-4 w-4" aria-hidden="true" />
                Call
              </a>
            )}
            {t.permissions.canEmail && t.realtor.email && <EmailButton context={{ kind: "realtor", id: t.realtor.id }} templateKey="realtor_follow_up" label="Email" className={actionClass} onChanged={onChanged} />}
          </div>
        </section>
      )}
      {viewer.canUpdateTasks && t.permissions.canUpdate && !t.completed && (
        <section className="space-y-3 px-5 py-4">
          <button type="button" disabled={pending} onClick={() => run(() => completeTask(t.id))} className={`${primaryClass} w-full disabled:opacity-60`}>
            Complete
          </button>
          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs text-slate-600">
              Reschedule to
              <input type="date" value={newDay} onChange={(e) => setNewDay(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <button type="button" disabled={pending || !newDay} onClick={() => run(() => rescheduleTask(t.id, newDay))} className={actionClass}>
              Reschedule
            </button>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="px-5 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="px-5 py-4">
        <Link href={t.realtor ? `/realtors/${t.realtor.id}` : t.transaction ? `/transactions/${t.transaction.id}` : "/tasks"} className={`${primaryClass} w-full`}>
          {t.realtor ? "Open realtor" : t.transaction ? "Open transaction" : "Open tasks"}
        </Link>
      </div>
    </div>
  );
}

const OCCASION_TEMPLATE: Partial<Record<CalendarEvent["type"], string>> = {
  birthday: "realtor_birthday",
  careerAnniversary: "realtor_career_anniversary",
  relationshipAnniversary: "realtor_relationship_anniversary",
};

function RealtorOccasionBody({ event }: { event: CalendarEvent }) {
  const [state] = useLoad<RealtorEventPreview>(() => getRealtorEventPreview(event.sourceId));
  if (state.status !== "ready") return <Status state={state} />;
  const r = state.data;
  return (
    <div className="divide-y divide-slate-100">
      <section className="space-y-1 px-5 py-4">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
          <EventIcon event={event} className="h-4 w-4" />
          {event.title}
        </p>
        <p className="text-sm text-slate-600">{formatDay(event.day, "long")}</p>
      </section>
      <section className="space-y-2 px-5 py-4 text-sm">
        <div>
          <Link href={`/realtors/${r.id}`} className="font-medium text-slate-900 hover:underline">
            {r.name}
          </Link>
          <p className="text-slate-600">{r.brokerage ?? "No brokerage"}</p>
        </div>
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-slate-500">Transactions</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-900">{r.transactions}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Referrals</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-900">{r.referrals}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2 pt-1">
          {r.phone && (
            <a href={telHref(r.phone)} className={actionClass}>
              <Phone className="h-4 w-4" aria-hidden="true" />
              Call
            </a>
          )}
          {r.permissions.canEmail && r.email && (
            <EmailButton context={{ kind: "realtor", id: r.id }} templateKey={OCCASION_TEMPLATE[event.type]} label={event.type === "birthday" ? "Prepare birthday email" : "Prepare email"} className={actionClass} />
          )}
          {!r.email && <span className="text-xs text-slate-500">No email on file.</span>}
        </div>
      </section>
      <div className="px-5 py-4">
        <Link href={`/realtors/${r.id}`} className={`${primaryClass} w-full`}>
          Open realtor
        </Link>
      </div>
    </div>
  );
}

function GenericBody({ event, timeZone, viewer, onChanged, onClose }: { event: CalendarEvent; timeZone: string; viewer: Viewer; onChanged: () => void; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canRemoveBlock = event.type === "block" && viewer.canBlockTime && (viewer.role !== "INSPECTOR" || event.inspectorId === viewer.userId);
  const openLabel: Partial<Record<CalendarEvent["type"], string>> = {
    reportDue: "Open report",
    closing: "Open transaction",
    inspectionDeadline: "Open transaction",
    invoiceDue: "Open transaction",
    appointment: "Open transaction",
  };
  return (
    <div className="divide-y divide-slate-100">
      <section className="space-y-1 px-5 py-4">
        <p className="flex items-center gap-1.5 font-medium text-slate-900">
          <EventIcon event={event} className="h-4 w-4" />
          {event.title}
        </p>
        <p className="text-sm text-slate-600">
          {formatDay(event.day, "long")}
          {!event.allDay && event.start && event.end && <span className="block">{formatTimeRange(new Date(event.start), new Date(event.end), timeZone)}</span>}
        </p>
        {event.subtitle && <p className="text-sm text-slate-700">{event.subtitle}</p>}
        {event.type === "reportDue" && <p className="text-xs text-slate-500">Based on the report turnaround after the inspection date. It leaves the Calendar once the report is delivered.</p>}
      </section>
      {error && (
        <p role="alert" className="px-5 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="space-y-2 px-5 py-4">
        {canRemoveBlock && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await removeBlockedTime(event.sourceId).catch(() => ({ ok: false as const, error: "You may not have permission to do that." }));
                if (!result.ok) return setError(result.error);
                onChanged();
                onClose();
              })
            }
            className={`${actionClass} w-full text-red-700`}
          >
            Remove blocked time
          </button>
        )}
        {event.href !== "/calendar" && (
          <Link href={event.href} className={`${primaryClass} w-full`}>
            {openLabel[event.type] ?? "Open record"}
          </Link>
        )}
      </div>
    </div>
  );
}
