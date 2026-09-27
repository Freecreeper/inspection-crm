import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { fetchBrokerageDirectory } from "@/lib/brokerages/directory";
import { parseBrokerageParams, type RawSearchParams } from "@/lib/brokerages/directoryParams";
import { AddBrokerageButton } from "./_components/AddBrokerageModal";
import { BrokeragesToolbar } from "./_components/BrokeragesToolbar";
import { BrokerageDirectory } from "./_components/BrokerageDirectory";

export default async function BrokeragesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = parseBrokerageParams(await searchParams);
  const session = await auth();
  const canWrite = can(session?.user?.role as Role | undefined, "crm:write");
  const { rows, total } = await fetchBrokerageDirectory(params);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Brokerages</h1>
        {canWrite && <AddBrokerageButton />}
      </div>
      <BrokeragesToolbar params={params} />
      <BrokerageDirectory rows={rows} total={total} params={params} />
    </div>
  );
}
