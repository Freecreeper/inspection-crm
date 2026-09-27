import Link from "next/link";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { EmailButton } from "@/components/email/EmailComposer";
import { CATEGORY_LABELS } from "@/components/email/EmailStatusBadge";
import { composeContextForMessage } from "@/lib/email/composer";

// Emails an automation prepared but a person must review and send
// (thank-yous, birthdays, anniversaries — and anything else set to
// "review before send").
export default async function NeedsReviewPage() {
  const session = await auth();
  const canSend = can(session?.user?.role as Role | undefined, "email:send");
  const drafts = await prisma.emailMessage.findMany({
    where: { status: "DRAFT", campaignId: null },
    orderBy: { createdAt: "asc" },
    include: { automation: { select: { name: true } }, realtor: true },
    take: 200,
  });

  return (
    <div>
      <p className="text-sm text-slate-600">Prepared by an automation and waiting for someone to review, personalize, and send. Nothing here goes out on its own.</p>
      <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {drafts.map((d) => {
          const context = composeContextForMessage(d);
          return (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <Link href={`/email/messages/${d.id}`} className="font-medium text-slate-900 hover:underline">
                  {d.subject || "(no subject)"}
                </Link>
                <p className="text-sm text-slate-600">
                  To {d.recipientName} · {CATEGORY_LABELS[d.category]} · {d.automation?.name ?? "Draft"}
                </p>
                <p className="text-xs text-slate-500">Prepared {d.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
              </div>
              {canSend && context && <EmailButton context={context} draftId={d.id} label="Review & send" />}
            </li>
          );
        })}
        {drafts.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-500">Nothing waiting for review.</li>}
      </ul>
    </div>
  );
}
