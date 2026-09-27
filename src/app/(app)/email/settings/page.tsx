import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { describeEmailDelivery, getEmailConfig } from "@/lib/email/config";
import { getEmailSettings } from "@/lib/email/settings";
import { SettingsForm, SuppressionManager } from "./SettingsForms";

export default async function EmailSettingsPage() {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  const [settings, suppressions] = await Promise.all([
    getEmailSettings(),
    prisma.emailSuppression.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  const delivery = describeEmailDelivery();
  const config = getEmailConfig();

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
      <SettingsForm
        canManage={can(role, "email:automation_manage")}
        initial={{
          companyName: settings.companyName,
          fromName: settings.fromName,
          fromEmail: settings.fromEmail ?? "",
          replyTo: settings.replyTo ?? "",
          signature: settings.signature,
          companyPhone: settings.companyPhone ?? "",
          companyWebsite: settings.companyWebsite ?? "",
          mailingAddress: settings.mailingAddress ?? "",
          inspectionPrepInstructions: settings.inspectionPrepInstructions ?? "",
          marketingRequiresOptIn: settings.marketingRequiresOptIn,
          campaignSendsPerMinute: settings.campaignSendsPerMinute,
        }}
        defaultFromEmail={config.defaultFromEmail}
      />

      <div className="space-y-6">
        <section aria-labelledby="provider" className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <h2 id="provider" className="text-sm font-semibold text-slate-900">
            Provider
          </h2>
          <dl className="mt-2 space-y-1.5">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Provider</dt>
              <dd>{delivery.providerName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Delivery mode</dt>
              <dd className="font-mono text-xs">{delivery.mode}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">API token</dt>
              <dd>{delivery.providerConfigured ? "Configured" : "Not configured"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Webhook</dt>
              <dd>{delivery.webhookConfigured ? "Configured" : "Not configured"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Streams</dt>
              <dd className="font-mono text-xs">
                {config.transactionalStream} / {config.broadcastStream}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            {delivery.summary} Credentials are set in the server environment only and never shown here. See docs/email.md.
          </p>
        </section>

        <SuppressionManager
          canManage={can(role, "email:preferences_manage")}
          rows={suppressions.map((s) => ({ id: s.id, email: s.email, scope: s.scope, reason: s.reason, source: s.source, createdAt: s.createdAt.toISOString() }))}
        />
      </div>
    </div>
  );
}
