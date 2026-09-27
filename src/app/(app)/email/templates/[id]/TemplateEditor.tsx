"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EmailCategory, EmailRecipientType } from "@prisma/client";
import { previewTemplate, saveTemplate } from "../../actions";

interface TemplateFields {
  name: string;
  description: string;
  category: EmailCategory;
  recipientType: EmailRecipientType;
  subject: string;
  body: string;
  active: boolean;
}

const input = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

export function TemplateEditor({
  id,
  initial,
  canManage,
  variables,
}: {
  id: string | null;
  initial: TemplateFields;
  canManage: boolean;
  variables: { key: string; label: string; sendTime: boolean }[];
}) {
  const router = useRouter();
  const uid = useId();
  const [fields, setFields] = useState(initial);
  const [preview, setPreview] = useState<{ subject: string; body: string; missing: string[]; unknown: string[] } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const set = <K extends keyof TemplateFields>(k: K, v: TemplateFields[K]) => (setFields({ ...fields, [k]: v }), setPreview(null));

  function insert(key: string) {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) return set("body", fields.body + token);
    const start = el.selectionStart ?? fields.body.length;
    const next = fields.body.slice(0, start) + token + fields.body.slice(el.selectionEnd ?? start);
    set("body", next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_16rem]">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(null);
          startTransition(async () => {
            try {
              const result = await saveTemplate(id, { ...fields, description: fields.description || null });
              if (!result.ok) return setMessage({ ok: false, text: result.error });
              setMessage({ ok: true, text: "Saved." });
              if (!id) router.push(`/email/templates/${result.data.id}`);
              else router.refresh();
            } catch {
              setMessage({ ok: false, text: "You may not have permission to edit templates." });
            }
          });
        }}
      >
        <fieldset disabled={!canManage} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-name`} className="block text-sm font-medium text-slate-700">Name</label>
              <input id={`${uid}-name`} value={fields.name} onChange={(e) => set("name", e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor={`${uid}-desc`} className="block text-sm font-medium text-slate-700">Description</label>
              <input id={`${uid}-desc`} value={fields.description} onChange={(e) => set("description", e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor={`${uid}-cat`} className="block text-sm font-medium text-slate-700">Type</label>
              <select id={`${uid}-cat`} value={fields.category} onChange={(e) => set("category", e.target.value as EmailCategory)} className={input}>
                <option value="TRANSACTIONAL">Operational (confirmations, reminders, invoices, reports)</option>
                <option value="RELATIONSHIP">Relationship (thank-yous, birthdays, follow-ups)</option>
                <option value="MARKETING">Marketing (announcements, promotions, newsletters)</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">Marketing email always includes an unsubscribe link and respects marketing preferences.</p>
            </div>
            <div>
              <label htmlFor={`${uid}-rt`} className="block text-sm font-medium text-slate-700">For</label>
              <select id={`${uid}-rt`} value={fields.recipientType} onChange={(e) => set("recipientType", e.target.value as EmailRecipientType)} className={input}>
                <option value="CUSTOMER">Customer</option>
                <option value="REALTOR">Realtor</option>
                <option value="OTHER">Report recipient</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor={`${uid}-subject`} className="block text-sm font-medium text-slate-700">Subject</label>
            <input id={`${uid}-subject`} value={fields.subject} onChange={(e) => set("subject", e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor={`${uid}-body`} className="block text-sm font-medium text-slate-700">Body</label>
            <textarea id={`${uid}-body`} ref={bodyRef} rows={14} value={fields.body} onChange={(e) => set("body", e.target.value)} className={`${input} font-mono text-[13px]`} />
            <p className="mt-1 text-xs text-slate-500">{'Add a fallback with {{inspector.name | "our inspector"}}. Without one, a missing value stops an automatic email rather than sending a blank.'}</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fields.active} onChange={(e) => set("active", e.target.checked)} />
            Active
          </label>
        </fieldset>

        {preview && (
          <section aria-label="Preview" className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="text-xs font-medium text-amber-800">Preview with sample data — values in [brackets] are examples, not real records.</p>
            <p className="mt-2 font-medium text-slate-900">{preview.subject}</p>
            <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-800">{preview.body}</pre>
            {preview.unknown.length > 0 && <p className="mt-2 text-xs font-medium text-red-600">Unknown fields: {preview.unknown.map((k) => `{{${k}}}`).join(", ")}</p>}
          </section>
        )}
        {message && (
          <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>
            {message.text}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  const result = await previewTemplate({ subject: fields.subject, body: fields.body });
                  if (result.ok) setPreview(result.data);
                  else setMessage({ ok: false, text: result.error });
                } catch {
                  setMessage({ ok: false, text: "You may not have permission to preview templates." });
                }
              })
            }
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Preview
          </button>
          {canManage && (
            <button type="submit" disabled={pending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
              {pending ? "Saving…" : "Save template"}
            </button>
          )}
        </div>
      </form>

      <aside aria-labelledby={`${uid}-vars`} className="rounded-lg border border-slate-200 bg-white p-3">
        <h3 id={`${uid}-vars`} className="text-xs font-medium uppercase tracking-wide text-slate-500">Available fields</h3>
        <ul className="mt-2 max-h-[32rem] space-y-1 overflow-y-auto text-sm">
          {variables.map((v) => (
            <li key={v.key}>
              <button type="button" disabled={!canManage} onClick={() => insert(v.key)} className="w-full rounded px-1.5 py-1 text-left hover:bg-slate-50 disabled:cursor-default">
                <code className="text-xs text-slate-800">{`{{${v.key}}}`}</code>
                <span className="block text-xs text-slate-500">
                  {v.label}
                  {v.sendTime && " — created at send time, never stored"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
