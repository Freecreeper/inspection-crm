import Link from "next/link";
import { notFound } from "next/navigation";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { formatPhone } from "@/lib/phone";
import { formatBrokerageAddress } from "@/lib/brokerages/directoryParams";
import { parseBrokerageTimelineFilter } from "@/lib/brokerages/record";
import { BrokerageQuickActions } from "../_components/BrokerageShared";
import { OverviewTab } from "./_components/OverviewTab";
import { RealtorsTab } from "./_components/RealtorsTab";
import { TransactionsTab } from "./_components/TransactionsTab";
import { ActivityTab } from "./_components/ActivityTab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "realtors", label: "Realtors" },
  { key: "transactions", label: "Transactions" },
  { key: "activity", label: "Activity" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// Same shape as the realtor record: a header with quick actions, then
// tabs that each render on the server only when opened (?tab=).
export default async function BrokerageRecordPage({
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
  const permissions = { canWrite: can(role, "crm:write"), canViewFinancials: can(role, "financial:read") };

  const brokerage = await prisma.brokerage.findFirst({ where: { id, archivedAt: null } });
  if (!brokerage) notFound();
  const address = formatBrokerageAddress(brokerage);

  return (
    <div className="max-w-5xl">
      <Link href={`/brokerages?selected=${brokerage.id}`} className="text-xs text-slate-500 hover:underline">
        ← Back to brokerages
      </Link>

      <header className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-slate-900">{brokerage.name}</h1>
          <p className="mt-1 text-sm text-slate-600">{address || <span className="text-slate-400">No address on file</span>}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            {/* Missing values are already called out on the action buttons. */}
            {brokerage.phone && <span className="tabular-nums">{formatPhone(brokerage.phone)}</span>}
            {brokerage.email && <span>{brokerage.email}</span>}
          </div>
        </div>
        <div className="lg:max-w-md">
          <BrokerageQuickActions brokerageId={brokerage.id} phone={brokerage.phone} email={brokerage.email} />
        </div>
      </header>

      <div className="mt-6 border-b border-slate-200">
        <nav aria-label="Brokerage record sections" className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "overview" ? `/brokerages/${brokerage.id}` : `/brokerages/${brokerage.id}?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t.key ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {tab === "overview" && <OverviewTab brokerage={brokerage} permissions={permissions} />}
        {tab === "realtors" && <RealtorsTab brokerageId={brokerage.id} />}
        {tab === "transactions" && <TransactionsTab brokerageId={brokerage.id} permissions={permissions} />}
        {tab === "activity" && <ActivityTab brokerageId={brokerage.id} filter={parseBrokerageTimelineFilter(type)} />}
      </div>
    </div>
  );
}
