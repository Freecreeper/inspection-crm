import Link from "next/link";
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
  const tab = (target: RealtorsView, label: string, href: string) => (
    <Link
      href={href}
      aria-current={view === target ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        view === target ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Realtors</h1>
        <nav aria-label="Realtor views" className="flex rounded-lg bg-slate-100 p-0.5">
          {tab("directory", "Directory", "/realtors")}
          {tab("followup", "Follow-up", "/realtors?view=followup")}
        </nav>
      </div>
      {canWrite && <AddRealtorButton brokerages={brokerages} defaultOpen={openAddOnLoad} />}
    </div>
  );
}
