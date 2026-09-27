import Link from "next/link";
import { notFound } from "next/navigation";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { sortAlphabetically } from "@/lib/sort";
import { describeAudience, parseAudience } from "@/lib/email/campaigns";
import { EmailStatusBadge } from "@/components/email/EmailStatusBadge";
import { CAMPAIGN_STATUS_LABELS } from "../../_components/campaignLabels";
import { CampaignEditor } from "./CampaignEditor";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  const [campaign, templates, brokerages, cities] = await Promise.all([
    id === "new"
      ? null
      : prisma.emailCampaign.findUnique({
          where: { id },
          include: {
            createdBy: { select: { name: true } },
            approvedBy: { select: { name: true } },
            messages: { orderBy: { recipientName: "asc" }, select: { id: true, recipientName: true, recipientEmail: true, status: true, statusReason: true, simulated: true } },
          },
        }),
    prisma.emailTemplate.findMany({ where: { active: true, recipientType: "REALTOR", category: { in: ["RELATIONSHIP", "MARKETING"] } }, orderBy: { name: "asc" } }),
    prisma.brokerage.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }),
    prisma.brokerage.findMany({ where: { archivedAt: null, city: { not: null } }, select: { city: true }, distinct: ["city"] }),
  ]);
  if (id !== "new" && !campaign) notFound();

  const audience = parseAudience(campaign?.audience);
  const brokerageNames = new Map(brokerages.map((b) => [b.id, b.name]));
  const counts = new Map<string, number>();
  for (const m of campaign?.messages ?? []) counts.set(m.status, (counts.get(m.status) ?? 0) + 1);

  return (
    <div className="max-w-5xl space-y-6">
      <Link href="/email/campaigns" className="text-xs text-slate-500 hover:underline">
        ← All campaigns
      </Link>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{campaign?.name ?? "New campaign"}</h2>
        {campaign && (
          <p className="text-sm text-slate-600">
            {CAMPAIGN_STATUS_LABELS[campaign.status]} · {describeAudience(audience, brokerageNames)}
            {campaign.approvedBy && ` · approved by ${campaign.approvedBy.name}`}
            {campaign.scheduledAt && ` · sends ${campaign.scheduledAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
          </p>
        )}
      </div>

      <CampaignEditor
        id={campaign?.id ?? null}
        status={campaign?.status ?? "DRAFT"}
        initial={{
          name: campaign?.name ?? "",
          category: campaign?.category === "RELATIONSHIP" ? "RELATIONSHIP" : "MARKETING",
          templateId: campaign?.templateId ?? "",
          subject: campaign?.subject ?? "",
          body: campaign?.body ?? "",
          audience,
        }}
        templates={templates.map((t) => ({ id: t.id, name: t.name, category: t.category, subject: t.subject, body: t.body }))}
        brokerages={sortAlphabetically(brokerages, (b) => b.name)}
        cities={cities.map((c) => c.city!).sort()}
        permissions={{ create: can(role, "email:campaign_create"), approve: can(role, "email:campaign_approve") }}
      />

      {campaign && campaign.messages.length > 0 && (
        <section aria-labelledby="recipients">
          <h3 id="recipients" className="text-sm font-semibold text-slate-900">
            Recipients
          </h3>
          <p className="mt-1 text-xs text-slate-500">{[...counts].map(([s, n]) => `${n} ${s.toLowerCase()}`).join(" · ")}</p>
          <ul className="mt-2 max-h-[28rem] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm">
            {campaign.messages.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
                <span>
                  <Link href={`/email/messages/${m.id}`} className="text-slate-900 hover:underline">
                    {m.recipientName}
                  </Link>
                  <span className="text-slate-500"> · {m.recipientEmail ?? "no email"}</span>
                </span>
                <span className="text-right">
                  <EmailStatusBadge status={m.status} simulated={m.simulated} />
                  {m.statusReason && !m.simulated && <span className="block text-xs text-slate-500">{m.statusReason}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
