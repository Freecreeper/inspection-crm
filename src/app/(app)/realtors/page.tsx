import Link from "next/link";
import { Building2, MoreHorizontal, Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

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

  const [realtors, totalCount, brokerages] = await Promise.all([
    prisma.realtor.findMany({
      where,
      orderBy,
      include: { brokerage: true, _count: { select: { transactions: true } } },
    }),
    prisma.realtor.count({ where: { archivedAt: null } }),
    prisma.brokerage.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
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

      <form method="get" className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search realtors by name, email, or brokerage..."
            className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <select
          name="brokerageId"
          defaultValue={brokerageId}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          <option value="">All brokerages</option>
          {brokerages.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          name="sort"
          defaultValue={sort}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          <option value="name">Sort by name</option>
          <option value="transactions">Sort by transactions</option>
          <option value="brokerage">Sort by brokerage</option>
        </select>
        <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Search
        </button>
      </form>

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="rounded-tl-lg px-4 py-3 font-medium">Realtor</th>
              <th className="px-4 py-3 font-medium">Brokerage</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium">Transactions</th>
              <th className="rounded-tr-lg px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {realtors.map((r, index) => {
              const palette = AVATAR_PALETTE[index % AVATAR_PALETTE.length];
              // The last couple of rows open their menu upward instead of
              // downward, so it isn't clipped by the table's own scroll
              // container (needed for horizontal overflow safety — see the
              // wrapping div) when there's no room below the last row.
              const openUpward = index >= realtors.length - 2;
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
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100">
                          <Building2 className="h-3.5 w-3.5 text-slate-500" />
                        </div>
                        <span className="text-slate-700">{r.brokerage.name}</span>
                      </div>
                    ) : (
                      <span className="text-slate-400">Not provided</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.phone || "Not provided"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                      {r._count.transactions}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <details className="group relative inline-block text-left">
                      <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 [&::-webkit-details-marker]:hidden">
                        <MoreHorizontal className="h-4 w-4" />
                      </summary>
                      <div
                        className={`absolute right-0 z-10 w-44 rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg ${
                          openUpward ? "bottom-full mb-1" : "mt-1"
                        }`}
                      >
                        <Link href={`/realtors/${r.id}`} className="block px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                          View profile
                        </Link>
                        {r.email && (
                          <a href={`mailto:${r.email}`} className="block px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                            Email
                          </a>
                        )}
                        {r.phone && (
                          <a href={`tel:${r.phone}`} className="block px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                            Call
                          </a>
                        )}
                      </div>
                    </details>
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
