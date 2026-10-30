"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmailButton } from "@/components/email/EmailComposer";
import { cancelSignatureRequestAction, requestSignatureAction } from "@/app/(app)/inspections/agreement-actions";

export interface PanelAgreement {
  id: string;
  status: "PENDING" | "SIGNED" | "REVOKED";
  signerName: string;
  signerEmail: string | null;
  url: string | null; // only for an open request
  expires: string;
  expired: boolean;
  signedName: string | null;
  signed: string | null;
}

const button = "rounded-md border border-input bg-surface px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-hover disabled:opacity-60";

// The inspection's agreement: request a signature, share or email the
// link, cancel it, or see who signed and when.
export function AgreementPanel({
  inspectionId,
  latest,
  customers,
  markedSigned,
  canRequest,
  canEmail,
  usesPlaceholder,
}: {
  inspectionId: string;
  latest: PanelAgreement | null;
  customers: { id: string; name: string; hasEmail: boolean }[];
  markedSigned: string | null; // signed by hand (no online signature)
  canRequest: boolean;
  canEmail: boolean;
  usesPlaceholder: boolean;
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const open = latest?.status === "PENDING" && !latest.expired ? latest : null;

  const request = () => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await requestSignatureAction(inspectionId, customerId || null);
        if (!result.ok) return setError(result.error);
        if (result.data.missing.length) setNotice(`Some details weren't on file and were left blank in the agreement: ${result.data.missing.join(", ")}.`);
        router.refresh();
      } catch {
        setError("You may not have permission to request signatures.");
      }
    });
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Inspection agreement</h2>
        {latest?.status === "SIGNED" ? (
          <span className="text-xs font-medium text-success-strong">Signed online</span>
        ) : markedSigned ? (
          <span className="text-xs text-neutral-600">Marked signed {markedSigned}</span>
        ) : open ? (
          <span className="text-xs text-warning-strong">Waiting for signature</span>
        ) : (
          <span className="text-xs text-muted-foreground">Not signed</span>
        )}
      </div>

      {latest?.status === "SIGNED" ? (
        <p className="mt-2 text-sm text-neutral-700">
          Signed by <strong>{latest.signedName}</strong> on {latest.signed} (sent to {latest.signerName}).{" "}
          <Link href={`/inspections/${inspectionId}/agreements/${latest.id}`} className="text-info-strong hover:underline">
            View signed copy
          </Link>
        </p>
      ) : open ? (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-neutral-700">
            Sent to {open.signerName}
            {open.signerEmail ? ` (${open.signerEmail})` : " (no email on file)"}. The link works until {open.expires}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(open.url!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  window.prompt("Copy the signing link:", open.url!);
                }
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            {canEmail && open.signerEmail && <EmailButton context={{ kind: "inspection", id: inspectionId }} templateKey="agreement_request" label="Email link" icon={false} className={button} />}
            {canRequest && (
              <button
                type="button"
                disabled={pending}
                className={button}
                onClick={() => {
                  if (!window.confirm("Cancel this request? Its link stops working right away.")) return;
                  setError(null);
                  startTransition(async () => {
                    const result = await cancelSignatureRequestAction(open.id);
                    if (!result.ok) setError(result.error);
                    router.refresh();
                  });
                }}
              >
                Cancel request
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {latest?.status === "PENDING" ? `The last link expired on ${latest.expires}.` : latest?.status === "REVOKED" ? "The last request was cancelled." : "Send the customer a link to read and sign it online."}
        </p>
      )}

      {canRequest && latest?.status !== "SIGNED" && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-3">
          {customers.length > 1 && (
            <label className="text-xs text-neutral-600">
              Signer
              <select value={customerId} disabled={pending} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 block rounded-md border border-input px-2 py-1 text-sm">
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.hasEmail ? "" : " (no email)"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" disabled={pending || customers.length === 0} onClick={request} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60">
            {pending ? "Preparing…" : open ? "Send a new link" : "Request signature"}
          </button>
          {customers.length === 0 && <span className="text-xs text-muted-foreground">Add a customer to the transaction first.</span>}
          {usesPlaceholder && <span className="text-xs text-warning-strong">Uses placeholder wording — an owner can set the real text in Settings → Agreement.</span>}
        </div>
      )}

      {notice && <p className="mt-2 text-xs text-warning-strong">{notice}</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger-strong">
          {error}
        </p>
      )}
    </section>
  );
}
