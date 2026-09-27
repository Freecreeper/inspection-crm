import Link from "next/link";
import { notFound } from "next/navigation";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { TEMPLATE_VARIABLES } from "@/lib/email/variables";
import { TemplateEditor } from "./TemplateEditor";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const canManage = can(session?.user?.role as Role | undefined, "email:template_manage");
  const template = id === "new" ? null : await prisma.emailTemplate.findUnique({ where: { id } });
  if (id !== "new" && !template) notFound();

  return (
    <div className="max-w-5xl">
      <Link href="/email/templates" className="text-xs text-slate-500 hover:underline">
        ← All templates
      </Link>
      <h2 className="mt-2 text-lg font-semibold text-slate-900">{template?.name ?? "New template"}</h2>
      {template?.automationEligible && (
        <p className="mt-1 text-sm text-slate-600">An automation uses this template. Edits apply to emails it sends from now on.</p>
      )}
      <TemplateEditor
        id={template?.id ?? null}
        canManage={canManage}
        initial={{
          name: template?.name ?? "",
          description: template?.description ?? "",
          category: template?.category ?? "TRANSACTIONAL",
          recipientType: template?.recipientType ?? "CUSTOMER",
          subject: template?.subject ?? "",
          body: template?.body ?? "",
          active: template?.active ?? true,
        }}
        variables={TEMPLATE_VARIABLES.map((v) => ({ key: v.key, label: v.label, sendTime: Boolean(v.sendTime) }))}
      />
    </div>
  );
}
