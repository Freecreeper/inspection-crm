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
      <h1 className="text-xl font-semibold text-slate-900">
        {lead.firstName} {lead.lastName}
      </h1>
      <p className="mt-1 font-mono text-xs uppercase tracking-wide text-slate-500">{lead.status}</p>

      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <dt className="text-slate-500">Email</dt>
        <dd className="text-slate-900">{lead.email || <span className="text-slate-400">Not provided</span>}</dd>
        <dt className="text-slate-500">Phone</dt>
        <dd className="text-slate-900">{lead.phone || <span className="text-slate-400">Not provided</span>}</dd>
        <dt className="text-slate-500">Referral source</dt>
        <dd className="text-slate-900">
          {lead.referralSource?.name || <span className="text-slate-400">Not provided</span>}
        </dd>
        <dt className="text-slate-500">Notes</dt>
        <dd className="text-slate-900">{lead.notes || <span className="text-slate-400">None</span>}</dd>
      </dl>

      {lead.status !== "CONVERTED" ? (
        <form action={convertAction} className="mt-6">
          <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Convert to customer + transaction
          </button>
          <p className="mt-2 text-xs text-slate-500">
            Creates a Customer and an open Transaction. Property, realtor, and referral source can all be
            added later — nothing here blocks conversion (§7).
          </p>
        </form>
      ) : (
        <p className="mt-6 text-sm text-slate-600">Converted on {lead.convertedAt?.toLocaleDateString()}.</p>
      )}
    </div>
  );
}
