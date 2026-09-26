import Link from "next/link";
import { formatShortDate } from "@/lib/dates";
import { loadRealtorDocuments } from "@/lib/realtors/record";
import type { RecordPermissions } from "./ui";

const MAX_ROWS = 200;

// Documents live on transactions (the existing Document model); this is
// every document on a deal the realtor was on or referred. Downloads go
// through /api/documents/[id], which enforces document:read itself.
export async function DocumentsTab({ realtorId, permissions }: { realtorId: string; permissions: RecordPermissions }) {
  if (!permissions.canReadDocuments) {
    return <p className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Your role doesn&apos;t have access to documents.</p>;
  }

  const documents = await loadRealtorDocuments(realtorId, MAX_ROWS);
  if (documents.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No documents on this realtor&apos;s transactions yet. Documents are uploaded from a transaction.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[600px] text-sm">
        <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-medium">Title</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Transaction</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Type</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Uploaded</th>
            <th scope="col" className="px-3 py-2.5">
              <span className="sr-only">Download</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => (
            <tr key={d.id} className="border-t border-slate-100 first:border-t-0">
              <td className="px-3 py-2.5 font-medium text-slate-900">{d.title}</td>
              <td className="px-3 py-2.5 text-slate-600">
                {d.transaction ? (
                  <Link href={`/transactions/${d.transaction.id}`} className="hover:underline">
                    {d.transaction.property ? `${d.transaction.property.addressLine1}, ${d.transaction.property.city}` : "Transaction"}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2.5 text-slate-600">{d.fileType}</td>
              <td className="px-3 py-2.5 tabular-nums text-slate-600">{formatShortDate(d.createdAt)}</td>
              <td className="px-3 py-2.5 text-right">
                <a href={`/api/documents/${d.id}`} className="text-sm text-emerald-700 hover:underline">
                  Download<span className="sr-only"> {d.title}</span>
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
