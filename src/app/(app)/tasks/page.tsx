import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createTask, completeTask } from "./actions";
import { getPrimaryCustomer } from "@/lib/transactions";
import { Combobox } from "@/components/Combobox";

export default async function TasksPage() {
  const [openTasks, users, transactions] = await Promise.all([
    prisma.task.findMany({
      where: { completedAt: null },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      include: {
        assignee: true,
        transaction: { include: { customers: { include: { customer: true } } } },
      },
      take: 100,
    }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.transaction.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: "desc" },
      include: { customers: { include: { customer: true } } },
      take: 50,
    }),
  ]);

  const now = new Date();

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Tasks</h1>
      <p className="mt-1 text-sm text-slate-500">Open follow-ups across every transaction, plus general office tasks.</p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Task</th>
                  <th className="px-4 py-2 font-medium">Transaction</th>
                  <th className="px-4 py-2 font-medium">Assignee</th>
                  <th className="px-4 py-2 font-medium">Due</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {openTasks.map((task) => {
                  const overdue = task.dueAt ? task.dueAt < now : false;
                  const completeAction = completeTask.bind(null, task.id);
                  const primaryCustomer = task.transaction ? getPrimaryCustomer(task.transaction.customers) : null;
                  return (
                    <tr key={task.id} className="border-t border-slate-100">
                      <td className="px-4 py-2">
                        <p className="font-medium text-slate-900">{task.title}</p>
                        {task.description && <p className="text-xs text-slate-500">{task.description}</p>}
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {task.transaction ? (
                          <Link href={`/transactions/${task.transaction.id}`} className="hover:underline">
                            {primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : "No customer yet"}
                          </Link>
                        ) : (
                          <span className="text-slate-400">General</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {task.assignee?.name || <span className="text-slate-400">Unassigned</span>}
                      </td>
                      <td className={`px-4 py-2 tabular-nums ${overdue ? "font-medium text-red-600" : "text-slate-600"}`}>
                        {task.dueAt ? task.dueAt.toLocaleDateString() : <span className="text-slate-400">No due date</span>}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <form action={completeAction}>
                          <button type="submit" className="text-xs text-blue-700 hover:underline">
                            Complete
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
                {openTasks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                      No open tasks.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">New task</h2>
          <form action={createTask} className="mt-3 space-y-3">
            <input name="title" placeholder="Title" required className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <textarea name="description" placeholder="Description (optional)" rows={2} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input name="dueAt" type="date" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700" />
            <Combobox name="assigneeId" placeholder="Unassigned" options={users.map((u) => ({ id: u.id, label: u.name }))} />
            <Combobox
              name="transactionId"
              placeholder="General task (no transaction)"
              options={transactions.map((t) => {
                const primaryCustomer = getPrimaryCustomer(t.customers);
                return {
                  id: t.id,
                  label: primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : `Transaction ${t.id.slice(-6)}`,
                };
              })}
            />
            <button type="submit" className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Add task
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
