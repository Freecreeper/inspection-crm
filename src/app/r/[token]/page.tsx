import type { Metadata } from "next";
import { formatBusinessDate } from "@/lib/businessTime";
import { notFound } from "next/navigation";
import { resolveDeliveryByToken, markDeliveryViewed } from "@/lib/delivery";
import type { ReportSnapshot } from "@/lib/reportEngine";
import { getBrand } from "@/lib/brand/service";
import { PublicBrandHeader } from "@/components/brand/PublicBrandHeader";

// The link itself is the credential: never send it on as a referrer (set in
// the page too, since the server in front of the app rewrites the header).
export const metadata: Metadata = { title: "Inspection report", referrer: "no-referrer", robots: { index: false, follow: false } };

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
  const brand = await getBrand();

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <PublicBrandHeader />
      <div className="rounded-lg border border-border bg-surface p-8 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{snapshot.reportNumber}</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">{snapshot.title || "Property Inspection Report"}</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {snapshot.property.addressLine1}, {snapshot.property.city}, {snapshot.property.state}{" "}
          {snapshot.property.zip}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Version {snapshot.versionNumber} — finalized {formatBusinessDate(snapshot.finalizedAt)}
        </p>
        {delivery.supersededBy && (
          <p role="status" className="mt-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-strong">
            This report has been revised: version {delivery.supersededBy} replaces this one. Ask your inspector for the updated report.
          </p>
        )}
        {snapshot.customerFacingNotes && <p className="mt-4 text-sm text-neutral-700">{snapshot.customerFacingNotes}</p>}
        <a
          href={`/r/${token}/pdf`}
          className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Download report (PDF)
        </a>
        <p className="mt-6 text-xs text-subtle">
          This link was sent to {delivery.recipientName}. Prepared by {brand.companyName} — not an engineering, legal, or
          code-compliance determination.
        </p>
      </div>
    </div>
  );
}
