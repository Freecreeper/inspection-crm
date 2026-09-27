"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CampaignStatus, EmailCategory } from "@prisma/client";
import type { Audience, AudiencePreview } from "@/lib/email/campaigns";
import { approveCampaign, cancelCampaign, getAudiencePreview, saveCampaign, submitCampaignForReview } from "../../actions";

const input = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

interface Fields {
  name: string;
  category: "RELATIONSHIP" | "MARKETING";
  templateId: string;
  subject: string;
  body: string;
  audience: Audience;
}

export function CampaignEditor({
  id,
  status,
  initial,
  templates,
  brokerages,
  cities,
  permissions,
}: {
  id: string | null;
  status: CampaignStatus;
  initial: Fields;
  templates: { id: string; name: string; category: EmailCategory; subject: string; body: string }[];
  brokerages: { id: string; name: string }[];
  cities: string[];
  permissions: { create: boolean; approve: boolean };
}) {
  const router = useRouter();
  const uid = useId();
  const [fields, setFields] = useState(initial);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [showList, setShowList] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const editable = permissions.create && (status === "DRAFT" || status === "READY_FOR_REVIEW");
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => (setFields({ ...fields, [k]: v }), setPreview(null));
  const setAudience = (changes: Partial<Audience>) => set("audience", { ...fields.audience, ...changes });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      setMessage(null);
      try {
        const result = await fn();
        if (!result.ok) return setMessage({ ok: false, text: result.error ?? "Couldn't do that." });
        setMessage({ ok: true, text: success });
        after?.();
        router.refresh();
      } catch {
        setMessage({ ok: false, text: "You may not have permission to do that." });
      }
    });

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <div className="space-y-5">
      <fieldset disabled={!editable || pending} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div>
            <label htmlFor={`${uid}-name`} className="block text-sm font-medium text-slate-700">Campaign name</label>
            <input id={`${uid}-name`} value={fields.name} onChange={(e) => set("name", e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor={`${uid}-cat`} className="block text-sm font-medium text-slate-700">Type</label>
            <select id={`${uid}-cat`} value={fields.category} onChange={(e) => set("category", e.target.value as Fields["category"])} className={input}>
              <option value="MARKETING">Marketing (announcements, promotions, educational content)</option>
              <option value="RELATIONSHIP">Relationship (non-promotional personal note)</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Marketing only goes to realtors who are eligible for marketing email, and always includes an unsubscribe link.
            </p>
          </div>
          <div>
            <label htmlFor={`${uid}-tpl`} className="block text-sm font-medium text-slate-700">Start from template</label>
            <select
              id={`${uid}-tpl`}
              value={fields.templateId}
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                setFields({
                  ...fields,
                  templateId: e.target.value,
                  subject: t?.subject ?? fields.subject,
                  body: t?.body ?? fields.body,
                  category: t?.category === "MARKETING" ? "MARKETING" : fields.category,
                });
              }}
              className={input}
            >
              <option value="">Pick a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-subject`} className="block text-sm font-medium text-slate-700">Subject</label>
            <input id={`${uid}-subject`} value={fields.subject} onChange={(e) => set("subject", e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor={`${uid}-body`} className="block text-sm font-medium text-slate-700">Message</label>
            <textarea id={`${uid}-body`} rows={10} value={fields.body} onChange={(e) => set("body", e.target.value)} className={`${input} font-mono text-[13px]`} />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Audience</h3>
          <p className="text-xs text-slate-500">All rules combine. Leave everything empty for all realtors.</p>
          <fieldset>
            <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">Brokerages</legend>
            <div className="mt-1 max-h-32 space-y-1 overflow-y-auto text-sm">
              {brokerages.map((b) => (
                <label key={b.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={fields.audience.brokerageIds.includes(b.id)} onChange={() => setAudience({ brokerageIds: toggle(fields.audience.brokerageIds, b.id) })} />
                  {b.name}
                </label>
              ))}
            </div>
          </fieldset>
          {cities.length > 0 && (
            <fieldset>
              <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">Brokerage city</legend>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {cities.map((c) => (
                  <label key={c} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={fields.audience.cities.includes(c)} onChange={() => setAudience({ cities: toggle(fields.audience.cities, c) })} />
                    {c}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div>
            <label htmlFor={`${uid}-active`} className="text-xs font-medium uppercase tracking-wide text-slate-500">Activity</label>
            <select
              id={`${uid}-active`}
              value={fields.audience.activeWithinMonths ?? ""}
              onChange={(e) => setAudience({ activeWithinMonths: e.target.value ? Number(e.target.value) : null })}
              className={input}
            >
              <option value="">Any time</option>
              <option value="3">Activity in the last 3 months</option>
              <option value="6">Activity in the last 6 months</option>
              <option value="12">Activity in the last 12 months</option>
            </select>
          </div>
          {fields.audience.realtorIds.length > 0 && (
            <p className="text-xs text-slate-600">
              Limited to {fields.audience.realtorIds.length} hand-picked realtors.{" "}
              <button type="button" className="underline" onClick={() => setAudience({ realtorIds: [] })}>
                Clear
              </button>
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  const result = await getAudiencePreview({ audience: fields.audience, category: fields.category });
                  if (result.ok) setPreview(result.data);
                  else setMessage({ ok: false, text: result.error });
                } catch {
                  setMessage({ ok: false, text: "You may not have permission to preview audiences." });
                }
              })
            }
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Preview audience
          </button>
        </div>
      </fieldset>

      {preview && (
        <section aria-label="Audience preview" className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p className="text-slate-900">
            <span className="text-2xl font-semibold tabular-nums">{preview.eligible.length}</span> eligible
            <span className="ml-3 text-slate-600">{preview.excluded.length} excluded</span>
          </p>
          {preview.reasons.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-slate-600">
              {preview.reasons.map((r) => (
                <li key={r.reason}>
                  {r.count} · {r.reason}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setShowList((v) => !v)} className="mt-2 text-sm text-emerald-700 hover:underline">
            {showList ? "Hide recipient list" : "Review recipient list"}
          </button>
          {showList && (
            <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
              <ul className="max-h-72 overflow-y-auto text-xs">
                {preview.eligible.map((m) => (
                  <li key={m.realtorId} className="py-0.5 text-slate-800">
                    {m.name} · {m.email}
                  </li>
                ))}
              </ul>
              <ul className="max-h-72 overflow-y-auto text-xs">
                {preview.excluded.map((m) => (
                  <li key={m.realtorId} className="py-0.5 text-slate-500">
                    {m.name} — {m.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        {editable && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                async () => {
                  const r = await saveCampaign(id, fields);
                  if (r.ok && !id) router.push(`/email/campaigns/${r.data.id}`);
                  return r;
                },
                status === "READY_FOR_REVIEW" ? "Saved — back to draft; submit again for review." : "Saved."
              )
            }
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            Save draft
          </button>
        )}
        {id && status === "DRAFT" && permissions.create && (
          <button type="button" disabled={pending} onClick={() => run(() => submitCampaignForReview(id), "Submitted for review.")} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Submit for review
          </button>
        )}
        {id && status === "READY_FOR_REVIEW" && permissions.approve && (
          <>
            <label className="text-xs text-slate-600">
              Send at (optional)
              <input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => approveCampaign(id, { sendAt: sendAt || null }), sendAt ? "Approved and scheduled." : "Approved — sending shortly.")}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Approve &amp; {sendAt ? "schedule" : "send"}
            </button>
          </>
        )}
        {id && status === "READY_FOR_REVIEW" && !permissions.approve && <p className="text-sm text-slate-600">Waiting for an owner to approve.</p>}
        {id && ["DRAFT", "READY_FOR_REVIEW", "SCHEDULED", "RUNNING"].includes(status) && permissions.create && (
          <button type="button" disabled={pending} onClick={() => run(() => cancelCampaign(id), "Campaign cancelled.")} className="rounded-md px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
            Cancel campaign
          </button>
        )}
      </div>
    </div>
  );
}
