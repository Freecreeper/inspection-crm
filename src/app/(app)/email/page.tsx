import Link from "next/link";
import type { EmailStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { EmailStatusBadge, CATEGORY_LABELS, MODE_LABELS } from "@/components/email/EmailStatusBadge";
import { MessageActions, ProcessQueueButton } from "./_components/MessageActions";

const FILTERS: Record<string, { label: string; statuses?: EmailStatus[] }> = {
  all: { label: "All" },
  pending: { label: "Scheduled & queued", statuses: ["SCHEDULED", "QUEUED", "SENDING"] },
  sent: { label: "Sent & delivered", statuses: ["SENT", "DELIVERED"] },
  problems: { label: "Needs attention", statuses: ["FAILED", "BOUNCED"] },
  skipped: { label: "Skipped & suppressed", statuses: ["SKIPPED", "SUPPRESSED"] },
};

const PAGE_SIZE = 50;

export default async function EmailMessagesPage({ searchParams }: { searchParams: Promise<{ filter?: string; category?: string; page?: string }> }) {
  const { filter = "all", category, page: pageRaw } = await searchParams;
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  const active = FILTERS[filter] ?? FILTERS.all;
  const page = Math.max(1, Number(pageRaw) || 1);

  const where: Prisma.EmailMessageWhereInput = { status: active.statuses ? { in: active.statuses } : { not: "DRAFT" } };
  if (category === "TRANSACTIONAL" || category === "RELATIONSHIP" || category === "MARKETING") where.category = category;

  const [messages, total] = await Promise.all([
    prisma.emailMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { template: { select: { name: true } }, automation: { select: { name: true } }, campaign: { select: { name: true } } },
    }),
    prisma.emailMessage.count({ where }),
  ]);

  const qs = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const next = { filter, category: category ?? null, ...changes };
    for (const [k, v] of Object.entries(next)) if (v && !(k === "filter" && v === "all")) p.set(k, v);
    const s = p.toString();
    return s ? `/email?${s}` : "/email";
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter messages" className="flex flex-wrap gap-2">
          {Object.entries(FILTERS).map(([key, f]) => (
            <Link
              key={key}
              href={qs({ filter: key, page: null })}
              aria-current={filter === key ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${filter === key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        {can(role, "email:automation_manage") && <ProcessQueueButton />}
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <caption className="sr-only">Email messages</caption>
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-medium">When</th>
              <th scope="col" className="px-3 py-2.5 font-medium">To</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Subject</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Source</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
              <th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id} className="border-t border-slate-100 align-top first:border-t-0">
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-600">
                  {(m.sentAt ?? m.scheduledFor ?? m.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {m.status === "SCHEDULED" && <span className="block text-xs text-slate-400">scheduled</span>}
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-slate-900">{m.recipientName}</span>
                  <span className="block text-xs text-slate-500">{m.recipientEmail ?? "no email"}</span>
                </td>
                <td className="px-3 py-2.5">
                  <Link href={`/email/messages/${m.id}`} className="text-slate-900 hover:underline">
                    {m.subject || "(no subject)"}
                  </Link>
                  <span className="block text-xs text-slate-500">{CATEGORY_LABELS[m.category]}</span>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-600">
                  {m.campaignId ? "Campaign" : MODE_LABELS[m.mode]}
                  <span className="block text-slate-500">{m.automation?.name ?? m.campaign?.name ?? m.template?.name ?? ""}</span>
                </td>
                <td className="px-3 py-2.5">
                  <EmailStatusBadge status={m.status} simulated={m.simulated} />
                  {m.statusReason && !m.simulated && <span className="mt-0.5 block max-w-xs text-xs text-slate-500">{m.statusReason}</span>}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <MessageActions id={m.id} status={m.status} canSend={can(role, "email:send")} campaign={m.campaignId !== null} />
                </td>
              </tr>
            ))}
            {messages.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                  No emails here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <p>{total > 0 ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}` : ""}</p>
        <div className="flex gap-2">
          {page > 1 && <Link href={qs({ page: String(page - 1) })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700">Previous</Link>}
          {page * PAGE_SIZE < total && <Link href={qs({ page: String(page + 1) })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700">Next</Link>}
        </div>
      </nav>
    </div>
  );
}
