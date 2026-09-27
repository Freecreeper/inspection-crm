import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { clientCalendarConfig, getCalendarConfig } from "@/lib/calendar/config";
import { loadCalendarEvents } from "@/lib/calendar/events";
import { normalizePreferences } from "@/lib/calendar/layers";
import { isDayKey, toDayKey, viewRange, type CalendarView } from "@/lib/calendar/time";
import { CalendarApp } from "./_components/CalendarApp";

// The Calendar renders its first range on the server (no loading flash),
// then the client fetches only the visible range as the user navigates.
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const params = await searchParams;
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  if (!can(role, "calendar:view")) {
    return <p className="text-sm text-slate-600">You don&apos;t have access to the Calendar.</p>;
  }
  const userId = session?.user?.id ?? null;
  const config = getCalendarConfig();

  const [user, services, inspectors] = await Promise.all([
    userId ? prisma.user.findUnique({ where: { id: userId }, select: { calendarPreferences: true } }) : null,
    prisma.service.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, defaultDurationMinutes: true } }),
    prisma.user.findMany({ where: { active: true, role: { in: ["INSPECTOR", "OWNER_ADMIN"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const preferences = normalizePreferences(user?.calendarPreferences);
  const view: CalendarView = params.view === "day" || params.view === "week" || params.view === "month" ? params.view : preferences.view;
  const today = toDayKey(new Date(), config.timeZone);
  const anchor = params.date && isDayKey(params.date) ? params.date : today;
  const { start, end } = viewRange(view, anchor, config.weekStartsOn);
  const events = await loadCalendarEvents({ start, end, layers: preferences.layers, inspectorId: preferences.inspectorId, role });

  return (
    <CalendarApp
      config={clientCalendarConfig(config)}
      initialPreferences={preferences}
      initialAnchor={anchor}
      initialView={view}
      initialEvents={events}
      today={today}
      options={{ services, inspectors }}
      viewer={{
        userId,
        role: role ?? null,
        canSchedule: can(role, "inspection:schedule"),
        canReschedule: can(role, "inspection:reschedule"),
        canCancel: can(role, "inspection:cancel"),
        canBlockTime: can(role, "calendar:block_time"),
        canUpdateTasks: can(role, "task:update"),
        canEmail: can(role, "email:send"),
      }}
    />
  );
}
