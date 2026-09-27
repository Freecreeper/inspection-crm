"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { Modal } from "@/components/Modal";
import {
  discardDraft,
  getComposerData,
  previewComposedEmail,
  submitComposedEmail,
  type ComposerData,
  type PreviewResult,
} from "@/app/(app)/email/actions";
import { CATEGORY_LABELS } from "./EmailStatusBadge";

export type ComposerContext = { kind: "realtor" | "customer" | "transaction" | "inspection" | "invoice"; id: string };

const input = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

// Opens the shared composer. `templateKey` preselects a template (e.g.
// "realtor_follow_up" for Prepare Follow-up); `draftId` opens a prepared
// draft for review. Everything that matters — recipients, permissions,
// eligibility, rendering, sending — is decided on the server.
export function EmailButton({
  context,
  label = "Email",
  templateKey,
  draftId,
  className,
  icon = true,
}: {
  context: ComposerContext;
  label?: string;
  templateKey?: string;
  draftId?: string;
  className?: string;
  icon?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        }
      >
        {icon && <Mail className="h-4 w-4" aria-hidden="true" />}
        {label}
      </button>
      {open && <EmailComposer context={context} templateKey={templateKey} draftId={draftId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function EmailComposer({
  context,
  templateKey,
  draftId,
  onClose,
  onSent,
}: {
  context: ComposerContext;
  templateKey?: string;
  draftId?: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [data, setData] = useState<ComposerData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recipientKey, setRecipientKey] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Keyed on the context's kind/id (not the object), so a parent that
  // re-renders with a fresh object doesn't reload and wipe the user's edits.
  const { kind, id: contextId } = context;
  useEffect(() => {
    let cancelled = false;
    getComposerData({ kind, id: contextId }, draftId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        if (d.draft) {
          setRecipientKey(d.draft.recipientKey);
          setTemplateId(d.draft.templateId);
          setSubject(d.draft.subject);
          setBody(d.draft.body);
          return;
        }
        const first = d.recipients.find((r) => !r.eligibility) ?? d.recipients[0];
        if (first) setRecipientKey(first.key);
        const chosen = templateKey ? d.templates.find((t) => t.key === templateKey) : null;
        if (chosen) {
          setTemplateId(chosen.id);
          setSubject(chosen.subject);
          setBody(chosen.body);
        }
      })
      .catch(() => !cancelled && setLoadError("Couldn't open the composer. You may not have permission."));
    return () => {
      cancelled = true;
    };
  }, [kind, contextId, draftId, templateKey]);

  const recipient = data?.recipients.find((r) => r.key === recipientKey) ?? null;
  const templates = useMemo(() => (data?.templates ?? []).filter((t) => !recipient || t.recipientType === recipient.type || t.recipientType === "OTHER"), [data, recipient]);
  const title = recipient ? `Email ${recipient.name}` : "Email";

  function chooseTemplate(nextId: string) {
    const t = data?.templates.find((x) => x.id === nextId);
    setTemplateId(t?.id ?? null);
    if (t) {
      setSubject(t.subject);
      setBody(t.body);
    }
    setPreview(null);
  }

  function runPreview() {
    setError(null);
    startTransition(async () => {
      const result = await previewComposedEmail({ context, recipientKey, templateId, subject, body, draftId: data?.draft?.id ?? null });
      if (result.ok) setPreview(result.data);
      else setError(result.error);
    });
  }

  function submit(action: "draft" | "send") {
    setError(null);
    startTransition(async () => {
      try {
        const result = await submitComposedEmail({ context, recipientKey, templateId, subject, body, draftId: data?.draft?.id ?? null, action });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
        if (action === "draft") {
          setNotice("Draft saved.");
          return;
        }
        onSent?.();
        onClose();
      } catch {
        setError("Couldn't save this email. You may not have permission to send email.");
      }
    });
  }

  function discard() {
    if (!data?.draft) return;
    startTransition(async () => {
      const result = await discardDraft(data.draft!.id);
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal open onClose={onClose} title={title} titleId={`${id}-title`}>
      {loadError && <p className="text-sm text-red-600">{loadError}</p>}
      {!data && !loadError && <p className="text-sm text-slate-500">Loading…</p>}
      {data && (
        <div className="space-y-3">
          {data.recipients.length === 0 ? (
            <p className="text-sm text-slate-500">There&apos;s no one to email from this record yet.</p>
          ) : (
            <div>
              <label htmlFor={`${id}-to`} className="block text-sm font-medium text-slate-700">
                To
              </label>
              <select
                id={`${id}-to`}
                value={recipientKey}
                disabled={Boolean(data.draft)}
                onChange={(e) => {
                  setRecipientKey(e.target.value);
                  setPreview(null);
                }}
                className={input}
              >
                {data.recipients.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name} — {r.email ?? "no email"} ({r.label})
                  </option>
                ))}
              </select>
              {recipient?.eligibility && (
                <p className="mt-1 text-xs text-amber-700" role="status">
                  Can&apos;t email {recipient.name}: {recipient.eligibility}. Add or fix their email on their record — nothing else is affected.
                </p>
              )}
            </div>
          )}

          <div>
            <label htmlFor={`${id}-template`} className="block text-sm font-medium text-slate-700">
              Template
            </label>
            <select id={`${id}-template`} value={templateId ?? ""} onChange={(e) => chooseTemplate(e.target.value)} className={input}>
              <option value="">No template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {CATEGORY_LABELS[t.category]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`${id}-subject`} className="block text-sm font-medium text-slate-700">
              Subject
            </label>
            <input id={`${id}-subject`} value={subject} onChange={(e) => (setSubject(e.target.value), setPreview(null))} className={input} />
          </div>

          <div>
            <label htmlFor={`${id}-body`} className="block text-sm font-medium text-slate-700">
              Message
            </label>
            <textarea id={`${id}-body`} rows={9} value={body} onChange={(e) => (setBody(e.target.value), setPreview(null))} className={`${input} font-mono text-[13px]`} />
            <p className="mt-1 text-xs text-slate-500">{"Fields like {{customer.firstName}} are filled in from the record. Preview to check."}</p>
          </div>

          {preview && (
            <section aria-label="Preview" className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-xs text-slate-500">
                To {preview.recipient.name} &lt;{preview.recipient.email ?? "no email"}&gt; · {CATEGORY_LABELS[preview.category]}
              </p>
              {preview.recipient.blockedReason && <p className="mt-1 text-xs font-medium text-amber-700">Won&apos;t send: {preview.recipient.blockedReason}</p>}
              <p className="mt-2 font-medium text-slate-900">{preview.subject}</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-800">{preview.body}</pre>
              {(preview.missing.length > 0 || preview.unknown.length > 0) && (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  Not on file (fill in or remove before sending): {[...preview.missing, ...preview.unknown.map((k) => `{{${k}}}`)].join(", ")}
                </p>
              )}
            </section>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {notice && !error && (
            <p role="status" className="text-sm text-emerald-700">
              {notice}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex gap-2">
              <button type="button" onClick={runPreview} disabled={pending || !recipientKey} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                Preview
              </button>
              {data.draft && data.canSend && (
                <button type="button" onClick={discard} disabled={pending} className="rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
                  Discard draft
                </button>
              )}
            </div>
            {data.canSend ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => submit("draft")} disabled={pending || !recipientKey} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60">
                  Save draft
                </button>
                <button
                  type="button"
                  onClick={() => submit("send")}
                  disabled={pending || !recipientKey || Boolean(recipient?.eligibility)}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {pending ? "Working…" : "Send"}
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Your role can view email but not send it.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
