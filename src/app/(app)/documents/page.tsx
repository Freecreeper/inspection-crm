import { formatBusinessDate } from "@/lib/businessTime";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getPrimaryCustomer } from "@/lib/transactions";

export default async function DocumentsPage() {
  const documents = await prisma.document.findMany({
    orderBy: { createdAt: "desc" },
    include: { transaction: { include: { customers: { include: { customer: true } } } } },
    take: 100,
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-neutral-900">Documents</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Files uploaded against a transaction. Uploads happen from the transaction page; downloads go
        through a session-gated route — nothing here is a public URL.
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Transaction</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Uploaded</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => {
              const primaryCustomer = d.transaction ? getPrimaryCustomer(d.transaction.customers) : null;
              return (
              <tr key={d.id} className="border-t border-neutral-100">
                <td className="px-4 py-2 font-medium text-neutral-900">{d.title}</td>
                <td className="px-4 py-2 text-neutral-600">
                  {d.transaction ? (
                    <Link href={`/transactions/${d.transaction.id}`} className="hover:underline">
                      {primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : "No customer yet"}
                    </Link>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-neutral-600">{d.fileType}</td>
                <td className="px-4 py-2 tabular-nums text-neutral-600">{formatBusinessDate(d.createdAt)}</td>
                <td className="px-4 py-2 text-right">
                  <a href={`/api/documents/${d.id}`} className="text-xs text-blue-700 hover:underline">
                    Download
                  </a>
                </td>
              </tr>
              );
            })}
            {documents.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                  No documents uploaded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
