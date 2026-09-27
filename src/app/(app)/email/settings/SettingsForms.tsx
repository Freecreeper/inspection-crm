"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSuppression, removeSuppression, updateEmailSettings } from "../actions";

const input = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

interface SettingsFields {
  companyName: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  signature: string;
  companyPhone: string;
  companyWebsite: string;
  mailingAddress: string;
  inspectionPrepInstructions: string;
  marketingRequiresOptIn: boolean;
  campaignSendsPerMinute: number;
}

export function SettingsForm({ initial, canManage, defaultFromEmail }: { initial: SettingsFields; canManage: boolean; defaultFromEmail: string | null }) {
  const router = useRouter();
  const id = useId();
  const [f, setF] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const text = (key: keyof SettingsFields, label: string, hint?: string, type = "text") => (
    <div>
      <label htmlFor={`${id}-${key}`} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input id={`${id}-${key}`} type={type} value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })} className={input} />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );

  return (
    <form
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          try {
            const result = await updateEmailSettings(f);
            setMessage(result.ok ? { ok: true, text: "Settings saved." } : { ok: false, text: result.error });
            router.refresh();
          } catch {
            setMessage({ ok: false, text: "You may not have permission to change email settings." });
          }
        });
      }}
    >
      <h2 className="text-sm font-semibold text-slate-900">Sending</h2>
      <fieldset disabled={!canManage || pending} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {text("companyName", "Company name")}
          {text("fromName", "From name")}
          {text("fromEmail", "From email", defaultFromEmail ? `Blank uses ${defaultFromEmail} (EMAIL_FROM). Must be a verified sender in Postmark.` : "Must be a verified sender in Postmark.", "email")}
          {text("replyTo", "Reply-to", "Where customer replies go.", "email")}
          {text("companyPhone", "Company phone")}
          {text("companyWebsite", "Company website")}
        </div>
        <div>
          <label htmlFor={`${id}-sig`} className="block text-sm font-medium text-slate-700">
            Signature
          </label>
          <textarea id={`${id}-sig`} rows={3} value={f.signature} onChange={(e) => setF({ ...f, signature: e.target.value })} className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-prep`} className="block text-sm font-medium text-slate-700">
            Inspection preparation instructions
          </label>
          <textarea id={`${id}-prep`} rows={3} value={f.inspectionPrepInstructions} onChange={(e) => setF({ ...f, inspectionPrepInstructions: e.target.value })} className={input} />
          <p className="mt-1 text-xs text-slate-500">{"Shown in confirmations and reminders via {{company.prepInstructions}}."}</p>
        </div>
      </fieldset>

      <h2 className="pt-2 text-sm font-semibold text-slate-900">Marketing</h2>
      <fieldset disabled={!canManage || pending} className="space-y-3">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={f.marketingRequiresOptIn} onChange={(e) => setF({ ...f, marketingRequiresOptIn: e.target.checked })} />
          <span>
            Only send marketing to realtors who have opted in
            <span className="block text-xs text-slate-500">
              Recommended. When off, marketing goes to any realtor with an email who hasn&apos;t unsubscribed — check the rules that apply to your business first.
            </span>
          </span>
        </label>
        {text("mailingAddress", "Mailing address", "Physical postal address included in every marketing email.")}
        <div>
          <label htmlFor={`${id}-rate`} className="block text-sm font-medium text-slate-700">
            Campaign emails per minute
          </label>
          <input
            id={`${id}-rate`}
            type="number"
            min={1}
            max={600}
            value={f.campaignSendsPerMinute}
            onChange={(e) => setF({ ...f, campaignSendsPerMinute: Number(e.target.value) })}
            className={`${input} w-32`}
          />
        </div>
      </fieldset>

      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
      {canManage && (
        <button type="submit" disabled={pending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
          {pending ? "Saving…" : "Save settings"}
        </button>
      )}
    </form>
  );
}

const SCOPES = { ALL: "All email (undeliverable)", NON_TRANSACTIONAL: "Relationship + marketing", MARKETING: "Marketing only" } as const;

export function SuppressionManager({
  rows,
  canManage,
}: {
  rows: { id: string; email: string; scope: keyof typeof SCOPES; reason: string; source: string; createdAt: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<keyof typeof SCOPES>("MARKETING");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      try {
        const r = await fn();
        if (!r.ok) setError(r.error ?? "Couldn't do that.");
        else setEmail("");
        router.refresh();
      } catch {
        setError("You may not have permission to manage suppressions.");
      }
    });

  return (
    <section aria-labelledby={`${id}-h`} className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <h2 id={`${id}-h`} className="text-sm font-semibold text-slate-900">
        Suppressed addresses
      </h2>
      <p className="mt-1 text-xs text-slate-500">Bounces and complaints are added automatically. A marketing suppression never blocks operational email.</p>
      {canManage && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addSuppression({ email, scope, reason: "Added by staff" }));
          }}
        >
          <label htmlFor={`${id}-email`} className="sr-only">
            Email address
          </label>
          <input id={`${id}-email`} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="address@example.com" className={input} />
          <div className="flex gap-2">
            <label htmlFor={`${id}-scope`} className="sr-only">
              Scope
            </label>
            <select id={`${id}-scope`} value={scope} onChange={(e) => setScope(e.target.value as keyof typeof SCOPES)} className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {Object.entries(SCOPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button type="submit" disabled={pending} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Add
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
      <ul className="mt-3 max-h-80 divide-y divide-slate-100 overflow-y-auto">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="block truncate text-slate-900">{r.email}</span>
              <span className="block text-xs text-slate-500">
                {SCOPES[r.scope]} · {r.reason}
              </span>
            </span>
            {canManage && (
              <button type="button" disabled={pending} onClick={() => run(() => removeSuppression(r.id))} className="shrink-0 text-xs text-slate-500 hover:text-red-700 hover:underline">
                Remove
              </button>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="py-3 text-xs text-slate-500">No suppressed addresses.</li>}
      </ul>
    </section>
  );
}
