import { notFound } from "next/navigation";
import { resolveDeliveryByToken, markDeliveryViewed } from "@/lib/delivery";
import type { ReportSnapshot } from "@/lib/reportEngine";

// Public, signed-token page — no staff session, no sidebar nav (outside the
// (app) route group's layout). Only customer-facing fields are shown here;
// internal notes, inspector notes, and staff-only report state never reach
// this route (§ "Report Cover Page": "Do not expose unnecessary Realtor or
// customer information unless configured").
//
// Everything shown here comes from `delivery.version.snapshot` — the
// immutable copy of the report as it existed at finalization — never from
// live Property/Inspection/Report records. A finalized version must keep
// showing what it showed when it was finalized, even if the Property (or
// anything else) is edited afterward. See ReportSnapshot in reportEngine.ts.
export default async function DeliveredReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const delivery = await resolveDeliveryByToken(token);
  if (!delivery) notFound();

  await markDeliveryViewed(delivery.id);
  const snapshot = delivery.version.snapshot as unknown as ReportSnapshot;

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-wide text-slate-500">{snapshot.reportNumber}</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{snapshot.title || "Property Inspection Report"}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {snapshot.property.addressLine1}, {snapshot.property.city}, {snapshot.property.state}{" "}
          {snapshot.property.zip}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Version {snapshot.versionNumber} — finalized {new Date(snapshot.finalizedAt).toLocaleDateString()}
        </p>
        {snapshot.customerFacingNotes && <p className="mt-4 text-sm text-slate-700">{snapshot.customerFacingNotes}</p>}
        <a
          href={`/r/${token}/pdf`}
          className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Download report (PDF)
        </a>
        <p className="mt-6 text-xs text-slate-400">
          This link was sent to {delivery.recipientName}. Prepared by Inspection CRM — not an engineering, legal, or
          code-compliance determination.
        </p>
      </div>
    </div>
  );
}
