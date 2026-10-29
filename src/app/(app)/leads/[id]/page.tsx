import { formatBusinessDate } from "@/lib/businessTime";
import { SubmitButton } from "@/components/SubmitButton";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { convertLead } from "../actions";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id }, include: { referralSource: true } });
  if (!lead) notFound();

  const convertAction = convertLead.bind(null, lead.id);

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold text-neutral-900">
        {lead.firstName} {lead.lastName}
      </h1>
      <p className="mt-1 font-mono text-xs uppercase tracking-wide text-neutral-500">{lead.status}</p>

      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-neutral-200 bg-surface p-4 text-sm">
        <dt className="text-neutral-500">Email</dt>
        <dd className="text-neutral-900">{lead.email || <span className="text-neutral-400">Not provided</span>}</dd>
        <dt className="text-neutral-500">Phone</dt>
        <dd className="text-neutral-900">{lead.phone || <span className="text-neutral-400">Not provided</span>}</dd>
        <dt className="text-neutral-500">Referral source</dt>
        <dd className="text-neutral-900">
          {lead.referralSource?.name || <span className="text-neutral-400">Not provided</span>}
        </dd>
        <dt className="text-neutral-500">Notes</dt>
        <dd className="text-neutral-900">{lead.notes || <span className="text-neutral-400">None</span>}</dd>
      </dl>

      {lead.status !== "CONVERTED" ? (
        <form action={convertAction} className="mt-6">
          <SubmitButton className="rounded-md bg-neutral-solid-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-solid-800">
            Convert to customer + transaction
          </SubmitButton>
          <p className="mt-2 text-xs text-neutral-500">
            Creates a Customer and an open Transaction. Property, realtor, and referral source can all be
            added later — nothing here blocks conversion (§7).
          </p>
        </form>
      ) : (
        <p className="mt-6 text-sm text-neutral-600">Converted on {lead.convertedAt ? formatBusinessDate(lead.convertedAt) : "an unknown date"}.</p>
      )}
    </div>
  );
}
