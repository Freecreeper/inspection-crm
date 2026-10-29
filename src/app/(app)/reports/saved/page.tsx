import { requireReportAccess } from "@/lib/reports/access";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { deleteSavedReport } from "../actions";

export default async function SavedReportsPage() {
  const { userId } = await requireReportAccess();
  const reports = await prisma.reportDefinition.findMany({
    where: { OR: [{ ownerId: userId }, { shared: true }] },
    include: { owner: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/reports" className="text-xs text-neutral-500 hover:underline">
        ← Reports
      </Link>
      <h1 className="text-xl font-semibold text-neutral-900">Saved reports</h1>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Entity</th>
              <th className="px-4 py-2 font-medium">Owner</th>
              <th className="px-4 py-2 font-medium">Visibility</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className="border-t border-neutral-100">
                <td className="px-4 py-2">
                  <Link href={`/reports/saved/${r.id}`} className="font-medium text-neutral-900 hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-neutral-600">{r.entity}</td>
                <td className="px-4 py-2 text-neutral-600">{r.owner.name}</td>
                <td className="px-4 py-2 text-neutral-600">{r.shared ? "Shared" : "Private"}</td>
                <td className="px-4 py-2 text-right">
                  {r.ownerId === userId && (
                    <form action={deleteSavedReport.bind(null, r.id)}>
                      <button type="submit" className="text-xs text-red-600 hover:underline">
                        Delete
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {reports.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                  No saved reports yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
