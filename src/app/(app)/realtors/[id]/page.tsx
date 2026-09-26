import Link from "next/link";
import { notFound } from "next/navigation";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { formatPhone } from "@/lib/phone";
import { brokerageLabel, realtorDisplayName, realtorLegalNameIfDifferent } from "@/lib/realtors/display";
import { parseTimelineFilter } from "@/lib/realtors/timeline";
import { StatusBadge } from "../_components/StatusBadge";
import { RecordQuickActions } from "./_components/RecordClient";
import { OverviewTab } from "./_components/OverviewTab";
import { TransactionsTab } from "./_components/TransactionsTab";
import { ReferralsTab } from "./_components/ReferralsTab";
import { ActivityTab } from "./_components/ActivityTab";
import { DocumentsTab } from "./_components/DocumentsTab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "transactions", label: "Transactions" },
  { key: "referrals", label: "Referrals" },
  { key: "activity", label: "Activity" },
  { key: "documents", label: "Documents" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// Each tab is its own server render (?tab=), so opening the record loads
// only the Overview's summary data — the full transaction list, referral
// list, timeline, and documents load when their tab is actually opened.
export default async function RealtorRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; type?: string }>;
}) {
  const [{ id }, { tab: tabRaw, type }] = await Promise.all([params, searchParams]);
  const tab: TabKey = TABS.some((t) => t.key === tabRaw) ? (tabRaw as TabKey) : "overview";

  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  const permissions = {
    canWrite: can(role, "crm:write"),
    canViewFinancials: can(role, "financial:read"),
    canReadDocuments: can(role, "document:read"),
  };

  const realtor = await prisma.realtor.findFirst({ where: { id, archivedAt: null }, include: { brokerage: true } });
  if (!realtor) notFound();

  const legalName = realtorLegalNameIfDifferent(realtor);

  return (
    <div className="max-w-5xl">
      <Link href={`/realtors?selected=${realtor.id}`} className="text-xs text-slate-500 hover:underline">
        ← Back to realtors
      </Link>

      <header className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-slate-900">{realtorDisplayName(realtor)}</h1>
          {legalName && <p className="text-xs text-slate-500">Legal name: {legalName}</p>}
          <p className="mt-1 text-sm text-slate-600">
            {realtor.brokerage ? (
              <Link href={`/brokerages/${realtor.brokerage.id}`} className="hover:text-slate-900 hover:underline">
                {brokerageLabel(realtor.brokerage)}
              </Link>
            ) : (
              <span className="text-slate-400">No brokerage on file</span>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            <StatusBadge active={realtor.active} />
            {/* Missing values are already called out on the action buttons. */}
            {realtor.phone && <span className="tabular-nums">{formatPhone(realtor.phone)}</span>}
            {realtor.email && <span>{realtor.email}</span>}
          </div>
        </div>
        <div className="lg:max-w-md">
          <RecordQuickActions realtorId={realtor.id} phone={realtor.phone} email={realtor.email} canWrite={permissions.canWrite} />
        </div>
      </header>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200">
        <nav aria-label="Realtor record sections" className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "overview" ? `/realtors/${realtor.id}` : `/realtors/${realtor.id}?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t.key ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <Link href={`/realtors/${realtor.id}/analytics`} className="mb-2 text-sm text-emerald-700 hover:underline">
          View relationship analytics →
        </Link>
      </div>

      <div className="mt-6">
        {tab === "overview" && <OverviewTab realtor={realtor} permissions={permissions} />}
        {tab === "transactions" && <TransactionsTab realtorId={realtor.id} permissions={permissions} />}
        {tab === "referrals" && <ReferralsTab realtorId={realtor.id} permissions={permissions} />}
        {tab === "activity" && <ActivityTab realtorId={realtor.id} filter={parseTimelineFilter(type)} permissions={permissions} />}
        {tab === "documents" && <DocumentsTab realtorId={realtor.id} permissions={permissions} />}
      </div>
    </div>
  );
}

