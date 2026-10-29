import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/invoices";
import { formatDuration } from "@/lib/calendar/time";

// What the business offers. Read-only for now: services are booked on
// inspections (price and length come from here); packages that switch
// report areas on and off will be built on these.
export default async function ServicesPage() {
  const services = await prisma.service.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { inspectionServices: true } } },
  });

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-foreground">Services &amp; Packages</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        What you offer, with the price and length used when an inspection is booked. Packages that choose which report areas are included are coming next.
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Service</th>
              <th className="px-4 py-2 text-right font-medium">Base price</th>
              <th className="px-4 py-2 font-medium">Default length</th>
              <th className="px-4 py-2 text-right font-medium">Times booked</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className={`border-t border-neutral-100 ${s.active ? "" : "text-subtle"}`}>
                <td className="px-4 py-2">
                  <p className={`font-medium ${s.active ? "text-foreground" : ""}`}>{s.name}</p>
                  {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(s.basePrice)}</td>
                <td className="px-4 py-2">{s.defaultDurationMinutes ? formatDuration(s.defaultDurationMinutes) : <span className="text-subtle">Not set</span>}</td>
                <td className="px-4 py-2 text-right tabular-nums">{s._count.inspectionServices}</td>
                <td className="px-4 py-2 text-xs">{s.active ? "Offered" : "Retired"}</td>
              </tr>
            ))}
            {services.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No services yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Report structure lives in <Link href="/report-templates" className="text-link hover:underline">Report Templates</Link>.
      </p>
    </div>
  );
}
