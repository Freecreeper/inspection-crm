import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { AddRealtorButton } from "./AddRealtorModal";

export type RealtorsView = "directory" | "followup";

// Directory and Follow-up are two views over the same Realtor records —
// switching is just a different query, never a different dataset.
export function RealtorsHeader({
  view,
  brokerages,
  canWrite,
  openAddOnLoad = false,
}: {
  view: RealtorsView;
  brokerages: { id: string; name: string }[];
  canWrite: boolean;
  openAddOnLoad?: boolean;
}) {
  return (
    <WorkspaceHeader
      title="Realtors"
      modesLabel="Realtor views"
      modes={[
        { key: "directory", label: "Directory", href: "/realtors" },
        { key: "followup", label: "Follow-up", href: "/realtors?view=followup" },
      ]}
      current={view}
      actions={canWrite && <AddRealtorButton brokerages={brokerages} defaultOpen={openAddOnLoad} />}
    />
  );
}
