import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getCalendarConfig } from "@/lib/calendar/config";
import { formatDay, zonedParts } from "@/lib/calendar/time";
import { OPTIONAL_ATTENTION, REQUIRED_ATTENTION, availableKpis, availableWidgets, canSeeAttention } from "@/lib/dashboard/registry";
import { defaultPreferences, resolvePreferences } from "@/lib/dashboard/preferences";
import { loadDashboard } from "@/lib/dashboard/service";
import { DashboardApp } from "./_components/DashboardApp";

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// Rendered per request (it reads the session), so a newly scheduled
// inspection, a paid invoice, or a completed task shows on the next load —
// there is no Dashboard cache to go stale. Only visible widgets are loaded.
export default async function DashboardPage() {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  const userId = session?.user?.id;
  if (!role || !userId || !can(role, "dashboard:view")) {
    return <p className="text-sm text-slate-600">You don&apos;t have access to the Dashboard.</p>;
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, dashboardPreferences: true } });
  const preferences = resolvePreferences(user?.dashboardPreferences, role);
  const now = new Date();
  const data = await loadDashboard({ userId, role }, preferences, now);
  const config = getCalendarConfig();
  const firstName = user?.name?.split(" ")[0] ?? null;

  return (
    <DashboardApp
      greeting={`${greetingFor(zonedParts(now, config.timeZone).hour)}${firstName ? `, ${firstName}` : ""}`}
      dateLabel={formatDay(data.today, "long")}
      today={data.today}
      timeZone={config.timeZone}
      defaultDurationMinutes={config.defaultDurationMinutes}
      initialPreferences={preferences}
      defaults={defaultPreferences(role)}
      widgets={availableWidgets(role)}
      kpis={availableKpis(role)}
      attention={{
        required: REQUIRED_ATTENTION.filter((c) => canSeeAttention(role, c.key)).map((c) => ({ key: c.key, label: c.label })),
        optional: OPTIONAL_ATTENTION.filter((c) => canSeeAttention(role, c.key)).map((c) => ({ key: c.key, label: c.label })),
      }}
      data={data.widgets}
      viewer={{
        userId,
        role,
        canSchedule: can(role, "inspection:schedule"),
        canReschedule: can(role, "inspection:reschedule"),
        canCancel: can(role, "inspection:cancel"),
        canBlockTime: can(role, "calendar:block_time"),
        canUpdateTasks: can(role, "task:update"),
        canEmail: can(role, "email:send"),
      }}
      canWriteCrm={can(role, "crm:write")}
      canSearch={can(role, "search:global")}
      canViewReports={can(role, "report-builder:use")}
    />
  );
}
