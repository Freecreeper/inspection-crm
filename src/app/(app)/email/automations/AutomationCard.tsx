"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EmailSendMode } from "@prisma/client";
import { updateAutomation } from "../actions";

type Config = Record<string, unknown>;

const FIELD_LABELS: Record<string, string> = {
  hoursBefore: "Hours before the inspection",
  daysBeforeDue: "Days before the due date",
  overdueRepeatDays: "Repeat every N days once overdue",
  maxOverdueReminders: "Maximum overdue reminders",
  daysBefore: "Days ahead to prepare",
  customers: "Customers",
  includeRealtors: "Also email the realtor",
  career: "Career anniversaries",
  relationship: "Working-together anniversaries",
};

// On/off, send mode, and the automation's numeric/boolean settings. Which
// template each one uses is edited on the Templates page, not here.
export function AutomationCard({
  automationKey,
  name,
  description,
  category,
  active: initialActive,
  sendMode: initialMode,
  config: initialConfig,
  canManage,
  modeLocked,
}: {
  automationKey: string;
  name: string;
  description: string;
  category: string;
  active: boolean;
  sendMode: EmailSendMode;
  config: Config;
  canManage: boolean;
  modeLocked: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [active, setActive] = useState(initialActive);
  const [sendMode, setSendMode] = useState(initialMode);
  const [config, setConfig] = useState<Config>(initialConfig);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (next: { active: boolean; sendMode: EmailSendMode; config: Config }) =>
    startTransition(async () => {
      try {
        const result = await updateAutomation(automationKey, next);
        setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
        if (!result.ok) {
          setActive(initialActive);
          setSendMode(initialMode);
        }
        router.refresh();
      } catch {
        setMessage({ ok: false, text: "You may not have permission to change automations." });
      }
    });

  const editable = Object.entries(config).filter(([k, v]) => k in FIELD_LABELS && (typeof v === "number" || typeof v === "boolean" || k === "customers"));

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-slate-900">{name}</h3>
          <p className="text-sm text-slate-600">{description}</p>
          <p className="mt-0.5 text-xs text-slate-500">{category}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-600">Mode</span>
            <select
              value={sendMode}
              disabled={!canManage || pending || modeLocked}
              onChange={(e) => {
                const next = e.target.value as EmailSendMode;
                setSendMode(next);
                save({ active, sendMode: next, config });
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="AUTOMATIC">Automatic</option>
              <option value="REVIEW">Review before send</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              role="switch"
              aria-checked={active}
              checked={active}
              disabled={!canManage || pending}
              onChange={(e) => {
                setActive(e.target.checked);
                save({ active: e.target.checked, sendMode, config });
              }}
            />
            {active ? "On" : "Off"}
          </label>
        </div>
      </div>

      {editable.length > 0 && (
        <form
          className="mt-3 flex flex-wrap items-end gap-4 border-t border-slate-100 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            save({ active, sendMode, config });
          }}
        >
          {editable.map(([key, value]) => (
            <label key={key} htmlFor={`${id}-${key}`} className="text-xs text-slate-600">
              {FIELD_LABELS[key]}
              {typeof value === "boolean" ? (
                <input
                  id={`${id}-${key}`}
                  type="checkbox"
                  className="ml-2 align-middle"
                  checked={value}
                  disabled={!canManage}
                  onChange={(e) => setConfig({ ...config, [key]: e.target.checked })}
                />
              ) : key === "customers" ? (
                <select
                  id={`${id}-${key}`}
                  value={String(value)}
                  disabled={!canManage}
                  onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                  className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm"
                >
                  <option value="all">Every customer on the transaction</option>
                  <option value="primary">Primary contact only</option>
                </select>
              ) : (
                <input
                  id={`${id}-${key}`}
                  type="number"
                  value={Number(value)}
                  disabled={!canManage}
                  onChange={(e) => setConfig({ ...config, [key]: Number(e.target.value) })}
                  className="mt-1 block w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              )}
            </label>
          ))}
          {canManage && (
            <button type="submit" disabled={pending} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60">
              Save settings
            </button>
          )}
        </form>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`mt-2 text-xs ${message.ok ? "text-emerald-700" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
    </li>
  );
}
