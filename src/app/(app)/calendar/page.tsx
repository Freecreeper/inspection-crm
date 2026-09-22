import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createAppointment, cancelAppointment } from "./actions";
import { getPrimaryCustomer } from "@/lib/transactions";

export default async function CalendarPage() {
  const [appointments, transactions] = await Promise.all([
    prisma.appointment.findMany({
      where: { cancelledAt: null },
      orderBy: { startAt: "asc" },
      include: {
        transaction: { include: { customers: { include: { customer: true } }, property: true } },
      },
      take: 100,
    }),
    prisma.transaction.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: "desc" },
      include: { customers: { include: { customer: true } } },
      take: 50,
    }),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Calendar</h1>
      <p className="mt-1 text-sm text-slate-500">
        Appointments — site visits, walkthroughs, and customer meetings. Inspection-specific scheduling
        lands once the Inspection module (Pillar 3) is built.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Transaction</th>
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {appointments.map((a) => {
                  const cancelAction = cancelAppointment.bind(null, a.id);
                  const primaryCustomer = a.transaction ? getPrimaryCustomer(a.transaction.customers) : null;
                  return (
                    <tr key={a.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 tabular-nums text-slate-700">
                        {a.startAt.toLocaleDateString()}{" "}
                        <span className="text-slate-400">
                          {a.startAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–
                          {a.endAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-900">{a.title}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {a.transaction ? (
                          <Link href={`/transactions/${a.transaction.id}`} className="hover:underline">
                            {primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : "No customer yet"}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{a.location || <span className="text-slate-400">—</span>}</td>
                      <td className="px-4 py-2 text-right">
                        <form action={cancelAction}>
                          <button type="submit" className="text-xs text-red-600 hover:underline">
                            Cancel
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
                {appointments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                      No upcoming appointments.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">New appointment</h2>
          <form action={createAppointment} className="mt-3 space-y-3">
            <input name="title" placeholder="Title" required className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-500">Start</label>
                <input name="startAt" type="datetime-local" required className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500">End</label>
                <input name="endAt" type="datetime-local" required className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              </div>
            </div>
            <input name="location" placeholder="Location (optional)" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <select name="transactionId" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700">
              <option value="">No transaction</option>
              {transactions.map((t) => {
                const primaryCustomer = getPrimaryCustomer(t.customers);
                return (
                  <option key={t.id} value={t.id}>
                    {primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : `Transaction ${t.id.slice(-6)}`}
                  </option>
                );
              })}
            </select>
            <button type="submit" className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Schedule
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
