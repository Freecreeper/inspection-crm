import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { signOutAction } from "./actions";
import { AppSidebar } from "./AppSidebar";
import { PERMISSIONS, can, type Permission } from "@/lib/rbac";
import type { Role } from "@prisma/client";
import { getCalendarConfig } from "@/lib/calendar/config";
import { toDayKey } from "@/lib/calendar/time";
import { ShellActions } from "./_shell/ShellActions";
import { getBrand } from "@/lib/brand/service";
import { toBrandProps } from "@/components/brand/PublicBrandHeader";

function humanizeRole(role: string): string {
  if (!role) return "";
  return role
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const displayName = session.user.name ?? session.user.email ?? "Signed in";
  const role = session.user.role as Role;
  const granted = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
  const calendar = getCalendarConfig();
  const brand = await getBrand();
  // Search and "+ New" in the top bar of every page; each control is shown
  // only to roles that may use it, and the server actions check again.
  const shellActions = (
    <ShellActions
      viewer={{
        userId: session.user.id ?? "",
        role,
        canSearch: can(role, "search:global"),
        canSchedule: can(role, "inspection:schedule"),
        canWriteCrm: can(role, "crm:write"),
        canAddTask: can(role, "task:update"),
      }}
      today={toDayKey(new Date(), calendar.timeZone)}
      timeZone={calendar.timeZone}
      defaultDurationMinutes={calendar.defaultDurationMinutes}
    />
  );

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar brand={{ ...toBrandProps(brand), iconUrl: brand.icon?.url ?? null }} displayName={displayName} roleLabel={humanizeRole(session.user.role ?? "")} granted={granted} signOutAction={signOutAction} actions={shellActions}>
        {children}
      </AppSidebar>
    </div>
  );
}
