import Link from "next/link";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { AUTOMATIONS, AUTOMATION_KEYS, getAutomation } from "@/lib/email/automations/registry";
import { CATEGORY_LABELS } from "@/components/email/EmailStatusBadge";
import { AutomationCard } from "./AutomationCard";

const RESULT_LABELS: Record<string, string> = {
  QUEUED: "Queued",
  SCHEDULED: "Scheduled",
  PREPARED: "Prepared for review",
  DRAFT: "Prepared for review",
  SKIPPED: "Skipped",
  SUPPRESSED: "Suppressed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export default async function AutomationsPage() {
  const session = await auth();
  const canManage = can(session?.user?.role as Role | undefined, "email:automation_manage");
  const automations = await Promise.all(AUTOMATION_KEYS.map(async (key) => ({ key, def: AUTOMATIONS[key], state: await getAutomation(key) })));
  const events = await prisma.automationEvent.findMany({
    where: { automation: { key: { not: null } } },
    orderBy: { firedAt: "desc" },
    take: 60,
    include: { automation: { select: { name: true } } },
  });
  const messageIds = events.map((e) => (e.detail as { emailMessageId?: string } | null)?.emailMessageId).filter((v): v is string => Boolean(v));
  const messages = messageIds.length
    ? await prisma.emailMessage.findMany({ where: { id: { in: messageIds } }, select: { id: true, status: true, statusReason: true, simulated: true } })
    : [];
  const messageById = new Map(messages.map((m) => [m.id, m]));

  return (
    <div className="space-y-8">
      <section aria-labelledby="rules">
        <h2 id="rules" className="text-sm font-semibold text-slate-900">
          Automations
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Each runs from real CRM events and dates only. Review-before-send prepares a draft in{" "}
          <Link href="/email/review" className="text-emerald-700 hover:underline">
            Needs review
          </Link>{" "}
          instead of sending. Realtor marketing is never automated — it goes through a campaign with human approval.
        </p>
        <ul className="mt-3 space-y-3">
          {automations.map(({ key, def, state }) => (
            <AutomationCard
              key={key}
              automationKey={key}
              name={def.name}
              description={def.description}
              category={CATEGORY_LABELS[def.category]}
              active={state.active}
              sendMode={state.sendMode}
              config={state.config as Record<string, unknown>}
              canManage={canManage}
              modeLocked={key === "report_ready"}
            />
          ))}
          <li className="rounded-lg border border-dashed border-slate-300 bg-white p-4">
            <h3 className="font-medium text-slate-900">Marketing campaigns</h3>
            <p className="text-sm text-slate-600">
              Always manual approval: audience previewed, reviewed, and approved by an owner before anything sends.{" "}
              <Link href="/email/campaigns" className="text-emerald-700 hover:underline">
                Campaigns →
              </Link>
            </p>
          </li>
        </ul>
      </section>

      <section aria-labelledby="log">
        <h2 id="log" className="text-sm font-semibold text-slate-900">
          Automation activity
        </h2>
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
          {events.map((e) => {
            const detail = (e.detail ?? {}) as { emailMessageId?: string; recipient?: string; reason?: string | null; stage?: string; occasion?: string };
            const msg = detail.emailMessageId ? messageById.get(detail.emailMessageId) : undefined;
            const current = msg ? (msg.simulated && msg.status === "SENT" ? "Sent (simulated)" : msg.status.charAt(0) + msg.status.slice(1).toLowerCase()) : null;
            const reason = msg?.statusReason && !msg.simulated ? msg.statusReason : detail.reason;
            return (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-slate-900">
                    {e.automation.name}
                    {detail.recipient && <span className="text-slate-600"> · {detail.recipient}</span>}
                    {detail.occasion && <span className="text-slate-500"> · {detail.occasion}</span>}
                    {detail.stage && <span className="text-slate-500"> · {detail.stage}</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {RESULT_LABELS[e.result] ?? e.result}
                    {current && current.toUpperCase() !== e.result && ` → now ${current}`}
                    {reason && ` · ${reason}`}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-slate-500">
                  {e.firedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {detail.emailMessageId && (
                    <Link href={`/email/messages/${detail.emailMessageId}`} className="text-emerald-700 hover:underline">
                      View
                    </Link>
                  )}
                </span>
              </li>
            );
          })}
          {events.length === 0 && <li className="px-4 py-8 text-center text-slate-500">No automation activity yet.</li>}
        </ul>
      </section>
    </div>
  );
}
