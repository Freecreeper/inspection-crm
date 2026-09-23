import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createRealtor } from "../actions";

export default async function NewRealtorPage() {
  const brokerages = await prisma.brokerage.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } });

  return (
    <div className="max-w-md">
      <Link href="/realtors" className="text-xs text-slate-500 hover:underline">
        ← Back to realtors
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">New realtor</h1>
      <form action={createRealtor} className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700">First name</label>
            <input name="firstName" required className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Last name</label>
            <input name="lastName" required className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Email (optional)</label>
          <input name="email" type="email" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Phone (optional)</label>
          <input name="phone" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Brokerage (optional)</label>
          <select name="brokerageId" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700">
            <option value="">No brokerage</option>
            {brokerages.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          Add realtor
        </button>
      </form>
    </div>
  );
}
