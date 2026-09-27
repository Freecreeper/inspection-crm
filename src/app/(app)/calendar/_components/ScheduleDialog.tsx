"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/Modal";
import { PhoneField } from "@/components/PhoneField";
import { AsyncCombobox, type AsyncOption } from "@/components/AsyncCombobox";
import { formatPhone } from "@/lib/phone";
import { formatDay, formatDuration, formatTime, formatTimeRange, zonedDateTimeToUtc } from "@/lib/calendar/time";
import type { SerializedConflict } from "@/lib/scheduling/service";
import type { CustomerDuplicate } from "@/lib/scheduling/records";
import {
  createCustomerQuick,
  createPropertyQuick,
  previewConflicts,
  scheduleInspectionAction,
  searchCustomersAction,
  searchPropertiesAction,
  searchRealtorsAction,
  type SchedulingOptions,
} from "../actions";

export const input =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
export const labelClass = "block text-sm font-medium text-slate-700";

export const DURATION_OPTIONS = [30, 45, 60, 90, 120, 150, 180, 210, 240, 300, 360, 480];

export function DurationSelect({ id, value, onChange }: { id: string; value: number; onChange: (m: number) => void }) {
  const options = DURATION_OPTIONS.includes(value) ? DURATION_OPTIONS : [...DURATION_OPTIONS, value].sort((a, b) => a - b);
  return (
    <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} className={input}>
      {options.map((m) => (
        <option key={m} value={m}>
          {formatDuration(m)}
        </option>
      ))}
    </select>
  );
}

// Live, advisory conflict preview; the server re-checks when saving.
export function useConflictPreview(args: { inspectorId: string | null; day: string; time: string; durationMinutes: number; excludeInspectionId?: string | null }) {
  const [conflicts, setConflicts] = useState<SerializedConflict[]>([]);
  const key = JSON.stringify(args);
  useEffect(() => {
    let cancelled = false;
    if (!args.inspectorId || !args.day || !args.time) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing when there's nothing to check
      setConflicts([]);
      return;
    }
    const timer = setTimeout(() => {
      previewConflicts(args)
        .then((c) => !cancelled && setConflicts(c))
        .catch(() => !cancelled && setConflicts([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return conflicts;
}

export function ConflictNotice({ conflicts, inspectorName, timeZone, proposed }: { conflicts: SerializedConflict[]; inspectorName: string | null; timeZone: string; proposed?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = conflicts.map((c) => c.id).join(",");
  // A long form can push the warning below the fold — bring it into view.
  useEffect(() => {
    if (key) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [key]);
  if (conflicts.length === 0) return null;
  return (
    <div ref={ref} role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Scheduling conflict
      </p>
      <p className="mt-1">{inspectorName ?? "This inspector"} already has:</p>
      <ul className="mt-1 space-y-0.5">
        {conflicts.map((c) => (
          <li key={c.kind + c.id}>
            <span className="font-medium">{c.kind === "block" ? `Blocked: ${c.title}` : c.title}</span> · {formatTimeRange(new Date(c.start), new Date(c.end), timeZone)}
          </li>
        ))}
      </ul>
      {proposed && <p className="mt-1.5 text-amber-800">Proposed: {proposed}</p>}
      <p className="mt-1.5 text-xs text-amber-800">Choose another time or inspector — overlapping inspections can&apos;t be saved.</p>
    </div>
  );
}

type Creating = { kind: "customer"; query: string } | { kind: "property"; query: string } | null;

export function ScheduleDialog({
  initialDay,
  initialTime,
  options,
  timeZone,
  defaultDurationMinutes,
  defaultInspectorId,
  onClose,
  onScheduled,
}: {
  initialDay: string;
  initialTime: string;
  options: SchedulingOptions;
  timeZone: string;
  defaultDurationMinutes: number;
  defaultInspectorId: string | null;
  onClose: () => void;
  onScheduled: (day: string) => void;
}) {
  const id = useId();
  const primaryDefault = useMemo(
    () => [...options.services].sort((a, b) => (b.defaultDurationMinutes ?? 0) - (a.defaultDurationMinutes ?? 0))[0]?.id ?? "",
    [options.services]
  );
  const [day, setDay] = useState(initialDay);
  const [time, setTime] = useState(initialTime);
  const [property, setProperty] = useState<AsyncOption | null>(null);
  const [customer, setCustomer] = useState<AsyncOption | null>(null);
  const [realtor, setRealtor] = useState<AsyncOption | null>(null);
  const [primaryService, setPrimaryService] = useState(primaryDefault);
  const [addOns, setAddOns] = useState<string[]>([]);
  const [inspectorId, setInspectorId] = useState(defaultInspectorId ?? (options.inspectors.length === 1 ? options.inspectors[0].id : ""));
  const [durationTouched, setDurationTouched] = useState(false);
  const [manualDuration, setManualDuration] = useState(defaultDurationMinutes);
  const [accessNotes, setAccessNotes] = useState("");
  const [creating, setCreating] = useState<Creating>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverConflicts, setServerConflicts] = useState<SerializedConflict[] | null>(null);
  const [pending, startTransition] = useTransition();

  const serviceIds = [primaryService, ...addOns].filter(Boolean);
  // Longest default among the chosen services, unless the user picked one.
  const suggested = useMemo(() => {
    const defaults = options.services.filter((s) => serviceIds.includes(s.id)).map((s) => s.defaultDurationMinutes ?? 0);
    const max = Math.max(0, ...defaults);
    return max > 0 ? max : defaultDurationMinutes;
  }, [options.services, serviceIds, defaultDurationMinutes]);
  const durationMinutes = durationTouched ? manualDuration : suggested;

  const preview = useConflictPreview({ inspectorId: inspectorId || null, day, time, durationMinutes });
  const conflicts = serverConflicts ?? preview;
  const inspectorName = options.inspectors.find((i) => i.id === inspectorId)?.name ?? null;

  function submit() {
    setError(null);
    setServerConflicts(null);
    if (!property) return setError("Pick a property.");
    startTransition(async () => {
      try {
        const result = await scheduleInspectionAction({
          propertyId: property.id,
          customerId: customer?.id ?? null,
          realtorId: realtor?.id ?? null,
          serviceIds,
          inspectorId: inspectorId || null,
          day,
          time,
          durationMinutes,
          accessNotes: accessNotes.trim() || null,
        });
        if (result.ok) return onScheduled(day);
        if ("conflicts" in result) setServerConflicts(result.conflicts);
        setError(result.error);
      } catch {
        setError("Couldn't schedule this inspection. You may not have permission.");
      }
    });
  }

  if (creating) {
    return (
      <Modal open onClose={() => setCreating(null)} title={creating.kind === "customer" ? "New customer" : "New property"} titleId={`${id}-create`}>
        {creating.kind === "customer" ? (
          <CreateCustomerForm
            query={creating.query}
            onCancel={() => setCreating(null)}
            onCreated={(option) => {
              setCustomer(option);
              setCreating(null);
            }}
          />
        ) : (
          <CreatePropertyForm
            query={creating.query}
            onCancel={() => setCreating(null)}
            onCreated={(option) => {
              setProperty(option);
              setCreating(null);
            }}
          />
        )}
      </Modal>
    );
  }

  const start = /^\d{4}-\d{2}-\d{2}$/.test(day) && /^\d{2}:\d{2}$/.test(time) ? `${formatDay(day, "short")}, ${formatTime(zonedDateTimeToUtc(day, time, timeZone), timeZone)}` : null;

  return (
    <Modal open onClose={onClose} title="New inspection" titleId={`${id}-title`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-day`} className={labelClass}>
              Date
            </label>
            <input id={`${id}-day`} type="date" required value={day} onChange={(e) => setDay(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor={`${id}-time`} className={labelClass}>
              Time
            </label>
            <input id={`${id}-time`} type="time" required step={900} value={time} onChange={(e) => setTime(e.target.value)} className={input} />
          </div>
        </div>

        <AsyncCombobox
          label="Property"
          required
          value={property}
          onChange={setProperty}
          search={searchPropertiesAction}
          placeholder="Search address…"
          onCreate={(query) => setCreating({ kind: "property", query })}
          createLabel={(q) => `+ Add “${q}” as a new property`}
        />
        <AsyncCombobox
          label="Customer"
          value={customer}
          onChange={setCustomer}
          search={searchCustomersAction}
          placeholder="Search name, phone, or email…"
          onCreate={(query) => setCreating({ kind: "customer", query })}
        />
        <AsyncCombobox label="Realtor" value={realtor} onChange={setRealtor} search={searchRealtorsAction} placeholder="Search realtor or brokerage…" />

        <div>
          <label htmlFor={`${id}-service`} className={labelClass}>
            Inspection type
          </label>
          <select
            id={`${id}-service`}
            value={primaryService}
            onChange={(e) => {
              setPrimaryService(e.target.value);
              setAddOns((a) => a.filter((s) => s !== e.target.value));
            }}
            className={input}
          >
            <option value="">No service yet</option>
            {options.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {options.services.filter((s) => s.id !== primaryService).length > 0 && (
          <fieldset>
            <legend className={labelClass}>Add-ons</legend>
            <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {options.services
                .filter((s) => s.id !== primaryService)
                .map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={addOns.includes(s.id)} onChange={(e) => setAddOns((a) => (e.target.checked ? [...a, s.id] : a.filter((x) => x !== s.id)))} />
                    {s.name}
                  </label>
                ))}
            </div>
          </fieldset>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-inspector`} className={labelClass}>
              Inspector
            </label>
            <select id={`${id}-inspector`} value={inspectorId} onChange={(e) => setInspectorId(e.target.value)} className={input}>
              <option value="">Not assigned yet</option>
              {options.inspectors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-duration`} className={labelClass}>
              Duration
            </label>
            <DurationSelect
              id={`${id}-duration`}
              value={durationMinutes}
              onChange={(m) => {
                setDurationTouched(true);
                setManualDuration(m);
              }}
            />
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-access`} className={labelClass}>
            Access notes <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea id={`${id}-access`} rows={2} value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} placeholder="Lockbox, occupant, gate code…" className={input} />
        </div>

        <ConflictNotice conflicts={conflicts} inspectorName={inspectorName} timeZone={timeZone} proposed={start ? `${property?.label ?? "This inspection"}, ${start} for ${formatDuration(durationMinutes)}` : null} />
        {error && !conflicts.length && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" disabled={pending || conflicts.length > 0} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
            {pending ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Create while scheduling (duplicate-checked on the server)
// ---------------------------------------------------------------------------

function DuplicateChoice<D extends { id: string }>({
  items,
  render,
  onUse,
  onCreateAnyway,
  onBack,
  pending,
}: {
  items: D[];
  render: (d: D) => React.ReactNode;
  onUse: (d: D) => void;
  onCreateAnyway: () => void;
  onBack: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">These existing records look like a match. Use one, or create a new record anyway.</p>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {items.map((d) => (
          <li key={d.id} className="flex items-start justify-between gap-3 p-3 text-sm">
            <div className="min-w-0">{render(d)}</div>
            <button type="button" onClick={() => onUse(d)} className="shrink-0 font-medium text-emerald-700 hover:underline">
              Use this
            </button>
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onBack} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          Back
        </button>
        <button type="button" disabled={pending} onClick={onCreateAnyway} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
          Create anyway
        </button>
      </div>
    </div>
  );
}

function CreateCustomerForm({ query, onCreated, onCancel }: { query: string; onCreated: (o: AsyncOption) => void; onCancel: () => void }) {
  const id = useId();
  const [first, ...rest] = query.trim().split(/\s+/);
  const [firstName, setFirstName] = useState(first ?? "");
  const [lastName, setLastName] = useState(rest.join(" "));
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<CustomerDuplicate[]>();
  const [pending, startTransition] = useTransition();

  const create = (confirmDuplicates: boolean) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await createCustomerQuick({ firstName, lastName, email, phone, confirmDuplicates });
        if (result.ok) return onCreated(result.data);
        if ("duplicates" in result) return setDuplicates(result.duplicates);
        setError(result.error);
      } catch {
        setError("Couldn't create the customer. You may not have permission.");
      }
    });

  if (duplicates) {
    return (
      <DuplicateChoice
        items={duplicates}
        pending={pending}
        render={(d) => (
          <>
            <p className="font-medium text-slate-900">{d.name}</p>
            <p className="truncate text-xs text-slate-500">{[d.phone ? formatPhone(d.phone) : null, d.email].filter(Boolean).join(" · ") || "No contact info"}</p>
            <p className="text-xs font-medium text-amber-700">{d.exact ? "Likely match" : "Possible match"}: {d.reasons.map((r) => (r === "name" ? "same name" : `same ${r}`)).join(", ")}</p>
          </>
        )}
        onUse={(d) => onCreated({ id: d.id, label: d.name, sublabel: [d.phone ? formatPhone(d.phone) : null, d.email].filter(Boolean).join(" · ") || "No contact info" })}
        onCreateAnyway={() => create(true)}
        onBack={() => setDuplicates(undefined)}
      />
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        create(false);
      }}
    >
      <p className="text-xs text-slate-500">Only a name is required — a missing email or phone never blocks scheduling.</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-first`} className={labelClass}>
            First name
          </label>
          <input id={`${id}-first`} required value={firstName} onChange={(e) => setFirstName(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-last`} className={labelClass}>
            Last name
          </label>
          <input id={`${id}-last`} required value={lastName} onChange={(e) => setLastName(e.target.value)} className={input} />
        </div>
      </div>
      <PhoneField value={phone} onChange={setPhone} />
      <div>
        <label htmlFor={`${id}-email`} className={labelClass}>
          Email <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          Back to scheduling
        </button>
        <button type="submit" disabled={pending} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending ? "Checking…" : "Create customer"}
        </button>
      </div>
    </form>
  );
}

function CreatePropertyForm({ query, onCreated, onCancel }: { query: string; onCreated: (o: AsyncOption) => void; onCancel: () => void }) {
  const id = useId();
  const [addressLine1, setAddressLine1] = useState(query.trim());
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<{ id: string; label: string; sublabel: string }[]>();
  const [pending, startTransition] = useTransition();

  const create = (confirmDuplicates: boolean) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await createPropertyQuick({ addressLine1, city, state, zip, confirmDuplicates });
        if (result.ok) return onCreated(result.data);
        if ("duplicates" in result) return setDuplicates(result.duplicates);
        setError(result.error);
      } catch {
        setError("Couldn't create the property. You may not have permission.");
      }
    });

  if (duplicates) {
    return (
      <DuplicateChoice
        items={duplicates}
        pending={pending}
        render={(d) => (
          <>
            <p className="font-medium text-slate-900">{d.label}</p>
            <p className="text-xs text-slate-500">{d.sublabel}</p>
            <p className="text-xs font-medium text-amber-700">Same address</p>
          </>
        )}
        onUse={(d) => onCreated(d)}
        onCreateAnyway={() => create(true)}
        onBack={() => setDuplicates(undefined)}
      />
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        create(false);
      }}
    >
      <div>
        <label htmlFor={`${id}-street`} className={labelClass}>
          Street address
        </label>
        <input id={`${id}-street`} required value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} autoComplete="street-address" className={input} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_5rem_6rem] gap-3">
        <div>
          <label htmlFor={`${id}-city`} className={labelClass}>
            City
          </label>
          <input id={`${id}-city`} required value={city} onChange={(e) => setCity(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-state`} className={labelClass}>
            State
          </label>
          <input id={`${id}-state`} required maxLength={2} value={state} onChange={(e) => setState(e.target.value)} placeholder="NC" className={`${input} uppercase`} />
        </div>
        <div>
          <label htmlFor={`${id}-zip`} className={labelClass}>
            ZIP
          </label>
          <input id={`${id}-zip`} required inputMode="numeric" maxLength={10} value={zip} onChange={(e) => setZip(e.target.value)} className={input} />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          Back to scheduling
        </button>
        <button type="submit" disabled={pending} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending ? "Checking…" : "Create property"}
        </button>
      </div>
    </form>
  );
}
