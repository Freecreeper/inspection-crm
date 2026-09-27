import Link from "next/link";
import { notFound } from "next/navigation";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { redactSendTime } from "@/lib/email/render";
import { composeContextForMessage } from "@/lib/email/composer";
import { realtorDisplayName } from "@/lib/realtors/display";
import { EmailStatusBadge, CATEGORY_LABELS, MODE_LABELS } from "@/components/email/EmailStatusBadge";
import { EmailButton } from "@/components/email/EmailComposer";
import { MessageActions } from "../../_components/MessageActions";

const fmt = (d: Date | null) => (d ? d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : null);

export default async function EmailMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  const m = await prisma.emailMessage.findUnique({
    where: { id },
    include: {
      template: true,
      automation: true,
      campaign: true,
      customer: true,
      realtor: true,
      inspection: { include: { property: true } },
      invoice: true,
      reportDelivery: { include: { version: true } },
      createdBy: { select: { name: true } },
      events: { orderBy: { occurredAt: "asc" } },
    },
  });
  if (!m) notFound();

  const timeline = [
    ["Created", fmt(m.createdAt)],
    ["Scheduled for", fmt(m.scheduledFor)],
    ["Queued", fmt(m.queuedAt)],
    ["Sent", fmt(m.sentAt)],
    ["Delivered", fmt(m.deliveredAt)],
    ["Bounced", fmt(m.bouncedAt)],
    ["Failed", fmt(m.failedAt)],
    ["Cancelled", fmt(m.cancelledAt)],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/email" className="text-xs text-slate-500 hover:underline">
        ← All messages
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{m.subject || "(no subject)"}</h2>
          <p className="mt-1 text-sm text-slate-600">
            To {m.recipientName} &lt;{m.recipientEmail ?? "no email"}&gt;
          </p>
          <div className="mt-1.5">
            <EmailStatusBadge status={m.status} simulated={m.simulated} />
          </div>
          {m.statusReason && <p className="mt-1 text-sm text-slate-600">{m.statusReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {m.status === "DRAFT" && composeContextForMessage(m) && can(role, "email:send") && (
            <EmailButton context={composeContextForMessage(m)!} draftId={m.id} label="Review & send" />
          )}
          <MessageActions id={m.id} status={m.status} canSend={can(role, "email:send")} campaign={m.campaignId !== null} />
        </div>
      </div>

      {m.status === "SKIPPED" && m.statusReason?.includes("email not provided") && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Add the missing address on{" "}
          {m.customer ? (
            <Link href={`/customers/${m.customer.id}`} className="font-medium underline">
              {m.customer.firstName} {m.customer.lastName}&apos;s record
            </Link>
          ) : m.realtor ? (
            <Link href={`/realtors/${m.realtor.id}`} className="font-medium underline">
              {realtorDisplayName(m.realtor)}&apos;s record
            </Link>
          ) : (
            "their record"
          )}
          , then Retry. Nothing else was affected.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">Type</dt>
          <dd>{CATEGORY_LABELS[m.category]}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Mode</dt>
          <dd>{m.campaignId ? "Campaign (owner-approved)" : MODE_LABELS[m.mode]}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Source</dt>
          <dd>{m.automation?.name ?? (m.campaign ? `Campaign: ${m.campaign.name}` : m.createdBy?.name ? `Sent by ${m.createdBy.name}` : "—")}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Template</dt>
          <dd>{m.template?.name ?? "None"}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-slate-500">Related</dt>
          <dd className="flex flex-wrap gap-x-3">
            {m.customer && <Link className="hover:underline" href={`/customers/${m.customer.id}`}>{m.customer.firstName} {m.customer.lastName}</Link>}
            {m.realtor && <Link className="hover:underline" href={`/realtors/${m.realtor.id}`}>{realtorDisplayName(m.realtor)}</Link>}
            {m.inspection && <Link className="hover:underline" href={`/inspections/${m.inspection.id}`}>Inspection · {m.inspection.property.addressLine1}</Link>}
            {m.transactionId && <Link className="hover:underline" href={`/transactions/${m.transactionId}`}>Transaction</Link>}
            {m.invoice && <span>Invoice {m.invoice.invoiceNumber}</span>}
            {m.reportDelivery && <span>Report version {m.reportDelivery.version.versionNumber}</span>}
          </dd>
        </div>
      </dl>

      <section aria-label="Message" className="rounded-lg border border-slate-200 bg-white p-4">
        <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800">{redactSendTime(m.bodyText)}</pre>
      </section>

      <section aria-labelledby="history" className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h3 id="history" className="text-sm font-semibold text-slate-900">History</h3>
        <ul className="mt-2 space-y-1">
          {timeline.map(([label, when]) => (
            <li key={label} className="flex justify-between gap-3">
              <span className="text-slate-700">{label}</span>
              <span className="tabular-nums text-slate-500">{when}</span>
            </li>
          ))}
          {m.events.map((e) => (
            <li key={e.id} className="flex justify-between gap-3">
              <span className="text-slate-700">Provider: {e.type.toLowerCase().replace("_", " ")}</span>
              <span className="tabular-nums text-slate-500">{fmt(e.occurredAt)}</span>
            </li>
          ))}
        </ul>
        {m.attempts > 1 && <p className="mt-2 text-xs text-slate-500">{m.attempts} send attempts.</p>}
      </section>
    </div>
  );
}
