import { prisma } from "@/lib/prisma";
import { createProperty } from "./actions";

export default async function PropertiesPage() {
  const properties = await prisma.property.findMany({ orderBy: { createdAt: "desc" }, take: 50 });

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Properties</h1>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Address</th>
                  <th className="px-4 py-2 font-medium">Year built</th>
                  <th className="px-4 py-2 font-medium">Sq ft</th>
                </tr>
              </thead>
              <tbody>
                {properties.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-900">
                      {p.addressLine1}, {p.city}, {p.state} {p.zip}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-slate-600">{p.yearBuilt ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-2 tabular-nums text-slate-600">{p.squareFootage ?? <span className="text-slate-400">—</span>}</td>
                  </tr>
                ))}
                {properties.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                      No properties yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">New property</h2>
          <form action={createProperty} className="mt-3 space-y-3">
            <input name="addressLine1" placeholder="Street address" required className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <div className="grid grid-cols-3 gap-2">
              <input name="city" placeholder="City" required className="col-span-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              <input name="state" placeholder="State" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              <input name="zip" placeholder="Zip" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input name="yearBuilt" placeholder="Year built (optional)" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              <input name="squareFootage" placeholder="Sq ft (optional)" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
            <button type="submit" className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Add property
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
