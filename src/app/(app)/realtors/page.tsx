import Link from "next/link";
import { Building2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { RealtorActionsMenu } from "./RealtorActionsMenu";
import { RealtorFilterBar } from "./RealtorFilterBar";
import { formatPhone } from "@/lib/phone";

const AVATAR_PALETTE = [
  { bg: "bg-emerald-100", text: "text-emerald-800" },
  { bg: "bg-indigo-100", text: "text-indigo-800" },
  { bg: "bg-teal-100", text: "text-teal-800" },
  { bg: "bg-amber-100", text: "text-amber-800" },
  { bg: "bg-sky-100", text: "text-sky-800" },
  { bg: "bg-rose-100", text: "text-rose-800" },
];

function initialsOf(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
}

export default async function RealtorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; brokerageId?: string; sort?: string }>;
}) {
  const { q = "", brokerageId = "", sort = "name" } = await searchParams;
  const query = q.trim();

  const where: Prisma.RealtorWhereInput = { archivedAt: null };
  if (brokerageId) where.brokerageId = brokerageId;
  if (query) {
    where.OR = [
      { firstName: { contains: query, mode: "insensitive" } },
      { lastName: { contains: query, mode: "insensitive" } },
      { email: { contains: query, mode: "insensitive" } },
      { brokerage: { name: { contains: query, mode: "insensitive" } } },
    ];
  }

  const orderBy: Prisma.RealtorOrderByWithRelationInput =
    sort === "transactions"
      ? { transactions: { _count: "desc" } }
      : sort === "brokerage"
        ? { brokerage: { name: "asc" } }
        : { lastName: "asc" };

  const [realtors, totalCount, brokerages, allRealtors] = await Promise.all([
    prisma.realtor.findMany({
      where,
      orderBy,
      include: { brokerage: true, _count: { select: { transactions: true } } },
    }),
    prisma.realtor.count({ where: { archivedAt: null } }),
    prisma.brokerage.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
    // Unfiltered, for the search box's typeahead suggestions — it needs
    // the full universe of realtors to search across, independent of
    // whatever `q`/`brokerageId` currently narrows the table to.
    prisma.realtor.findMany({
      where: { archivedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true, brokerage: { select: { name: true } } },
      orderBy: { lastName: "asc" },
    }),
  ]);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Realtors</h1>
          <p className="mt-1 text-sm text-slate-500">Build and manage your realtor relationships.</p>
        </div>
        <Link
          href="/realtors/new"
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          + Add Realtor
        </Link>
      </div>

      <RealtorFilterBar
        initialQuery={query}
        initialBrokerageId={brokerageId}
        initialSort={sort}
        brokerages={brokerages}
        suggestions={allRealtors.map((r) => ({
          id: r.id,
          label: `${r.firstName} ${r.lastName}`,
          sublabel: r.email ?? r.brokerage?.name ?? undefined,
        }))}
      />

      {/*
        table-fixed + explicit column widths + truncation keeps every row
        within the container's own w-full — the table can never grow wider
        than its box, so this wrapper doesn't need overflow-x-auto (which
        would clip the actions menu's vertical overflow along with it).
      */}
      <div className="mt-6 rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-[30%] rounded-tl-lg px-4 py-3 font-medium">Realtor</th>
              <th className="w-[24%] px-4 py-3 font-medium">Brokerage</th>
              <th className="w-[20%] px-4 py-3 font-medium">Contact</th>
              <th className="w-[13%] px-4 py-3 font-medium">Transactions</th>
              <th className="w-[13%] rounded-tr-lg px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {realtors.map((r, index) => {
              const palette = AVATAR_PALETTE[index % AVATAR_PALETTE.length];
              return (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${palette.bg} ${palette.text}`}
                      >
                        {initialsOf(r.firstName, r.lastName)}
                      </div>
                      <div className="min-w-0">
                        <Link href={`/realtors/${r.id}`} className="block truncate font-medium text-slate-900 hover:underline">
                          {r.firstName} {r.lastName}
                        </Link>
                        <p className="truncate text-xs text-slate-500">{r.email || "Not provided"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {r.brokerage ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100">
                          <Building2 className="h-3.5 w-3.5 text-slate-500" />
                        </div>
                        <span className="truncate text-slate-700">{r.brokerage.name}</span>
                      </div>
                    ) : (
                      <span className="text-slate-400">Not provided</span>
                    )}
                  </td>
                  <td className="truncate px-4 py-3 text-slate-600">{formatPhone(r.phone) || "Not provided"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                      {r._count.transactions}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RealtorActionsMenu realtorId={r.id} email={r.email} phone={r.phone} />
                  </td>
                </tr>
              );
            })}
            {realtors.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  No realtors match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Showing {realtors.length} of {totalCount} realtors
      </p>
    </div>
  );
}
