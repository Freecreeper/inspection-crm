import Link from "next/link";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { CATEGORY_LABELS } from "@/components/email/EmailStatusBadge";

const RECIPIENT = { CUSTOMER: "Customer", REALTOR: "Realtor", OTHER: "Report recipient" } as const;

export default async function TemplatesPage() {
  const session = await auth();
  const canManage = can(session?.user?.role as Role | undefined, "email:template_manage");
  const templates = await prisma.emailTemplate.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-neutral-600">The copy every email starts from. Only the listed fields can be filled in — templates are text, never code.</p>
        {canManage && (
          <Link href="/email/templates/new" className="rounded-md bg-neutral-solid-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-solid-800">
            New template
          </Link>
        )}
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200 bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-medium">Template</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Type</th>
              <th scope="col" className="px-3 py-2.5 font-medium">For</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-t border-neutral-100 first:border-t-0">
                <td className="px-3 py-2.5">
                  <Link href={`/email/templates/${t.id}`} className="font-medium text-neutral-900 hover:underline">
                    {t.name}
                  </Link>
                  <span className="block text-xs text-neutral-500">{t.subject || "(no subject)"}</span>
                </td>
                <td className="px-3 py-2.5 text-neutral-600">{CATEGORY_LABELS[t.category]}</td>
                <td className="px-3 py-2.5 text-neutral-600">
                  {RECIPIENT[t.recipientType]}
                  {t.automationEligible && <span className="block text-xs text-neutral-500">Used by an automation</span>}
                </td>
                <td className="px-3 py-2.5 text-neutral-600">{t.active ? "Active" : "Inactive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
