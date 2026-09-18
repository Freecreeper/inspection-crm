import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createLead } from "./actions";

export default async function LeadsPage() {
  const leads = await prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: 50 });

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Leads</h1>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Contact</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link href={`/leads/${lead.id}`} className="font-medium text-slate-900 hover:underline">
                        {lead.firstName} {lead.lastName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {lead.email || lead.phone || <span className="text-slate-400">Not provided</span>}
                    </td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                        {lead.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {leads.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                      No leads yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">New lead</h2>
          <form action={createLead} className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <input name="firstName" placeholder="First name" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              <input name="lastName" placeholder="Last name" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
            <input name="email" type="email" placeholder="Email (optional)" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input name="phone" placeholder="Phone (optional)" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <textarea name="notes" placeholder="Notes (optional)" rows={2} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <button type="submit" className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Add lead
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
