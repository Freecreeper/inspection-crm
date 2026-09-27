"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRealtorEmailPreferences, updateRealtorRelationshipDates } from "../../actions";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const input = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

export interface RelationshipEmailData {
  realtorId: string;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  careerStartDate: string | null;
  relationshipStartDate: string | null;
  relationshipEmailsEnabled: boolean;
  marketingOptIn: boolean;
  marketingOptInSource: string | null;
  marketingOptInAt: string | null;
  marketingUnsubscribedAt: string | null;
  hasEmail: boolean;
  suppression: string | null;
  lastRelationshipEmailAt: string | null;
  lastMarketingEmailAt: string | null;
}

const short = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);

// Optional relationship dates and category-specific email preferences. None
// of this is required; nothing is ever assumed when it's missing.
export function RelationshipEmailCard({ data, canEditDates, canEditPreferences }: { data: RelationshipEmailData; canEditDates: boolean; canEditPreferences: boolean }) {
  const router = useRouter();
  const id = useId();
  const [dates, setDates] = useState({
    birthdayMonth: data.birthdayMonth,
    birthdayDay: data.birthdayDay,
    careerStartDate: data.careerStartDate ?? "",
    relationshipStartDate: data.relationshipStartDate ?? "",
  });
  const [prefs, setPrefs] = useState({ relationshipEmailsEnabled: data.relationshipEmailsEnabled, marketingOptIn: data.marketingOptIn, marketingOptInSource: data.marketingOptInSource ?? "" });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setMessage(null);
      try {
        const r = await fn();
        setMessage(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error ?? "Couldn't save." });
        if (r.ok) router.refresh();
      } catch {
        setMessage({ ok: false, text: "You may not have permission to change this." });
      }
    });

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            updateRealtorRelationshipDates(data.realtorId, {
              birthdayMonth: dates.birthdayMonth,
              birthdayDay: dates.birthdayDay,
              careerStartDate: dates.careerStartDate || null,
              relationshipStartDate: dates.relationshipStartDate || null,
            })
          );
        }}
      >
        <fieldset disabled={!canEditDates || pending} className="space-y-3">
          <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">Relationship dates (optional)</legend>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${id}-bm`} className="text-xs text-slate-600">
                Birthday month
              </label>
              <select
                id={`${id}-bm`}
                value={dates.birthdayMonth ?? ""}
                onChange={(e) => setDates({ ...dates, birthdayMonth: e.target.value ? Number(e.target.value) : null, birthdayDay: e.target.value ? dates.birthdayDay : null })}
                className={input}
              >
                <option value="">Not on file</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-bd`} className="text-xs text-slate-600">
                Day
              </label>
              <select id={`${id}-bd`} value={dates.birthdayDay ?? ""} disabled={!dates.birthdayMonth} onChange={(e) => setDates({ ...dates, birthdayDay: e.target.value ? Number(e.target.value) : null })} className={input}>
                <option value="">—</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-500">No birth year is ever stored.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-career`} className="text-xs text-slate-600">
                Real estate career start
              </label>
              <input id={`${id}-career`} type="date" value={dates.careerStartDate} onChange={(e) => setDates({ ...dates, careerStartDate: e.target.value })} className={input} />
            </div>
            <div>
              <label htmlFor={`${id}-rel`} className="text-xs text-slate-600">
                Started working with us
              </label>
              <input id={`${id}-rel`} type="date" value={dates.relationshipStartDate} onChange={(e) => setDates({ ...dates, relationshipStartDate: e.target.value })} className={input} />
            </div>
          </div>
          {canEditDates && (
            <button type="submit" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Save dates
            </button>
          )}
        </fieldset>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateRealtorEmailPreferences(data.realtorId, { ...prefs, marketingOptInSource: prefs.marketingOptInSource || null }));
        }}
      >
        <fieldset disabled={!canEditPreferences || pending} className="space-y-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">Email preferences</legend>
          <p className="text-xs text-slate-500">Operational email about their transactions is never affected by these.</p>
          {!data.hasEmail && <p className="text-sm text-amber-700">No email on file — no email can be sent until one is added.</p>}
          {data.suppression && <p className="text-sm text-amber-700">Address suppressed: {data.suppression}</p>}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={prefs.relationshipEmailsEnabled} onChange={(e) => setPrefs({ ...prefs, relationshipEmailsEnabled: e.target.checked })} />
            Relationship emails (thank-yous, birthdays, check-ins)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={prefs.marketingOptIn} onChange={(e) => setPrefs({ ...prefs, marketingOptIn: e.target.checked })} />
            Opted in to marketing email
          </label>
          {prefs.marketingOptIn && !data.marketingOptIn && (
            <div>
              <label htmlFor={`${id}-src`} className="text-xs text-slate-600">
                How they agreed (required)
              </label>
              <input id={`${id}-src`} value={prefs.marketingOptInSource} onChange={(e) => setPrefs({ ...prefs, marketingOptInSource: e.target.value })} placeholder="e.g. Signed up at open house" className={input} />
            </div>
          )}
          <dl className="space-y-0.5 text-xs text-slate-500">
            {data.marketingOptIn && data.marketingOptInAt && (
              <div>
                Opted in {short(data.marketingOptInAt)}
                {data.marketingOptInSource && ` · ${data.marketingOptInSource}`}
              </div>
            )}
            {data.marketingUnsubscribedAt && <div>Unsubscribed from marketing {short(data.marketingUnsubscribedAt)}</div>}
            <div>Last relationship email: {short(data.lastRelationshipEmailAt) ?? "never"}</div>
            <div>Last marketing email: {short(data.lastMarketingEmailAt) ?? "never"}</div>
          </dl>
          {canEditPreferences && (
            <button type="submit" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Save preferences
            </button>
          )}
        </fieldset>
      </form>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-xs ${message.ok ? "text-emerald-700" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
