import Link from "next/link";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { CATEGORY_LABELS } from "@/components/email/EmailStatusBadge";
import { CAMPAIGN_STATUS_LABELS } from "../_components/campaignLabels";


export default async function CampaignsPage() {
  const session = await auth();
  const canCreate = can(session?.user?.role as Role | undefined, "email:campaign_create");
  const campaigns = await prisma.emailCampaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } }, _count: { select: { messages: true } } },
    take: 100,
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">One email to many realtors — a service announcement, seasonal note, or update. Every campaign needs an owner&apos;s approval before it sends.</p>
        {canCreate && (
          <Link href="/email/campaigns/new" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            New campaign
          </Link>
        )}
      </div>
      <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {campaigns.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <Link href={`/email/campaigns/${c.id}`} className="font-medium text-slate-900 hover:underline">
                {c.name}
              </Link>
              <p className="text-xs text-slate-500">
                {CATEGORY_LABELS[c.category]} · created by {c.createdBy?.name ?? "—"} {c.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {c._count.messages > 0 && ` · ${c._count.messages} recipients recorded`}
              </p>
            </div>
            <span className="text-sm text-slate-700">{CAMPAIGN_STATUS_LABELS[c.status]}</span>
          </li>
        ))}
        {campaigns.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-500">No campaigns yet.</li>}
      </ul>
    </div>
  );
}
