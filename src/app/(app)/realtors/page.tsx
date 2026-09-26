import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { sortAlphabetically } from "@/lib/sort";
import { parseDirectoryParams, type RawSearchParams } from "@/lib/realtors/directoryParams";
import { fetchDirectoryPage } from "@/lib/realtors/directory";
import { parseFollowUpFilter } from "@/lib/realtors/followUp";
import { RealtorsHeader } from "./_components/RealtorsHeader";
import { DirectoryToolbar } from "./_components/DirectoryToolbar";
import { DirectoryView } from "./_components/DirectoryView";
import { FollowUpView } from "./_components/FollowUpView";
import { DirectoryLayoutProvider } from "./_components/DirectoryLayoutContext";
import { normalizeDirectoryLayout } from "@/lib/realtors/directoryLayout";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RealtorsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const raw = await searchParams;
  const session = await auth();
  const canWrite = can(session?.user?.role as Role | undefined, "crm:write");
  const view = first(raw.view) === "followup" ? "followup" : "directory";

  // Names only — used by the brokerage filter and the Add Realtor picker.
  const brokerages = sortAlphabetically(
    await prisma.brokerage.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }),
    (b) => b.name
  );

  const header = <RealtorsHeader view={view} brokerages={brokerages} canWrite={canWrite} openAddOnLoad={first(raw.new) === "1"} />;

  if (view === "followup") {
    return (
      <div>
        {header}
        <FollowUpView filter={parseFollowUpFilter(first(raw.filter))} canWrite={canWrite} />
      </div>
    );
  }

  const params = parseDirectoryParams(raw);
  const [{ rows, total }, user] = await Promise.all([
    fetchDirectoryPage(params),
    session?.user?.id ? prisma.user.findUnique({ where: { id: session.user.id }, select: { realtorDirectoryLayout: true } }) : null,
  ]);

  return (
    <div>
      {header}
      <DirectoryLayoutProvider initial={normalizeDirectoryLayout(user?.realtorDirectoryLayout)}>
        <DirectoryToolbar params={params} brokerages={brokerages} />
        <DirectoryView
          params={params}
          total={total}
          initialSelectedId={first(raw.selected) ?? null}
          rows={rows.map((r) => ({
            id: r.id,
            firstName: r.firstName,
            lastName: r.lastName,
            preferredName: r.preferredName,
            email: r.email,
            phone: r.phone,
            brokerageId: r.brokerageId,
            brokerageName: r.brokerageName,
            transactionCount: r.transactionCount,
            referralCount: r.referralCount,
            lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
            nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null,
            openTaskCount: r.openTaskCount,
          }))}
        />
      </DirectoryLayoutProvider>
    </div>
  );
}
