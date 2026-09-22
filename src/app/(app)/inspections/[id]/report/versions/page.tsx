import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { amendReport, createDelivery } from "../../../report-actions";

export default async function ReportVersionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inspection = await prisma.inspection.findUnique({
    where: { id },
    include: {
      reports: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          versions: { orderBy: { versionNumber: "desc" }, include: { createdBy: true, deliveries: true } },
        },
      },
    },
  });
  if (!inspection) notFound();
  const report = inspection.reports[0];
  if (!report) notFound();

  const cookieStore = await cookies();
  const flashToken = cookieStore.get("delivery_token_flash")?.value;

  const amendAction = amendReport.bind(null, report.id);
  const deliverAction = createDelivery.bind(null, report.id);
  const canAmend = report.status === "FINALIZED" || report.status === "DELIVERED";
  const canDeliver = report.versions.length > 0 && report.status !== "DRAFT" && report.status !== "IN_PROGRESS";

  return (
    <div className="max-w-2xl space-y-6">
      <Link href={`/inspections/${id}/report`} className="text-xs text-slate-500 hover:underline">
        ← Back to report
      </Link>
      <h1 className="text-xl font-semibold text-slate-900">Version history &amp; delivery</h1>

      {flashToken && (
        <section className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">Delivery link created — copy it now, it won&apos;t be shown again here.</p>
          <p className="mt-1 text-xs">
            Email delivery isn&apos;t configured in this environment (no SMTP/Postmark credentials) — share this link
            with the recipient yourself.
          </p>
          <code className="mt-2 block break-all rounded bg-white px-2 py-1.5 text-xs">{`/r/${flashToken}`}</code>
        </section>
      )}

      {canAmend && (
        <form action={amendAction}>
          <button type="submit" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100">
            Amend this report
          </button>
        </form>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Versions</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {report.versions.map((v) => (
            <li key={v.id} className="rounded-md bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800">Version {v.versionNumber}</span>
                {v.pdfStorageKey && (
                  <a href={`/api/reports/versions/${v.id}/pdf`} className="text-xs text-blue-700 hover:underline">
                    Download PDF
                  </a>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Finalized {v.finalizedAt.toLocaleString()} by {v.createdBy?.name ?? "Unknown"}
              </p>
              {v.reasonForRevision && <p className="mt-1 text-xs text-slate-600">Reason: {v.reasonForRevision}</p>}
              {v.deliveries.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {v.deliveries.map((d) => (
                    <li key={d.id}>
                      → {d.recipientName} ({d.recipientType}) — <span className="font-mono">{d.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {report.versions.length === 0 && <p className="text-slate-400">No finalized versions yet.</p>}
        </ul>
      </section>

      {canDeliver && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Deliver latest version</h2>
          <p className="mt-1 text-xs text-slate-500">
            Recipients are always explicit — never auto-selected from transaction participants.
          </p>
          <form action={deliverAction} className="mt-3 space-y-2">
            <select name="recipientType" required className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="CUSTOMER">Customer</option>
              <option value="SECONDARY_CUSTOMER">Secondary customer</option>
              <option value="REALTOR">Realtor</option>
              <option value="OTHER_AUTHORIZED">Other authorized recipient</option>
            </select>
            <input name="recipientName" required placeholder="Recipient name" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input name="recipientEmail" type="email" required placeholder="Recipient email" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <button type="submit" className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Create delivery link
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
