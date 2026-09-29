import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/rbac";
import { loadCalendarEvents } from "@/lib/calendar/events";
import { addDays, toDayKey } from "@/lib/calendar/time";
import type { CalendarEvent } from "@/lib/calendar/types";
import { realtorDisplayName } from "@/lib/realtors/display";
import { loadRecentActivity } from "./activity";
import { loadAttention, reportAttention } from "./attention";
import { loadKpis, monthPeriod, weekPeriod } from "./metrics";
import { effectiveOptions, visibleWidgets, type DashboardPreferences } from "./preferences";
import { canUseWidget, type WidgetKey } from "./registry";
import { createDashboardContext, type DashboardContext, type DashboardViewer, type OpenTask } from "./sources";
import type { InvoiceRow, TaskRow, UpcomingDay, WidgetData, WidgetResult } from "./types";

// The Dashboard's read side. The page resolves the user's preferences
// (already permission-filtered), then loads only the visible widgets, in
// parallel, sharing one DashboardContext so records several widgets need
// are fetched once. A widget that fails shows an error in its own card;
// the rest of the Dashboard still renders.

const LIST_LIMIT = 8;

function taskRow(t: OpenTask, ctx: DashboardContext): TaskRow {
  const due = t.dueAt ? toDayKey(t.dueAt, ctx.config.timeZone) : null;
  const property = t.transaction?.property ? `${t.transaction.property.addressLine1}, ${t.transaction.property.city}` : null;
  return {
    id: t.id,
    title: t.title,
    due,
    overdue: due !== null && due < ctx.today,
    assigneeName: t.assignee?.name ?? null,
    context: t.realtor ? realtorDisplayName(t.realtor) : property,
    href: t.realtor ? `/realtors/${t.realtor.id}` : t.transaction ? `/transactions/${t.transaction.id}` : "/tasks",
    realtor: t.realtor ? { id: t.realtor.id, name: realtorDisplayName(t.realtor), phone: t.realtor.phone } : null,
  };
}

const byTime = (a: CalendarEvent, b: CalendarEvent) =>
  Number(a.allDay) - Number(b.allDay) || (a.start ?? "").localeCompare(b.start ?? "") || a.title.localeCompare(b.title);

export async function loadWidget(key: WidgetKey, ctx: DashboardContext, prefs: DashboardPreferences): Promise<WidgetData> {
  // Authoritative check — whatever the stored layout or the request says.
  if (!canUseWidget(ctx.viewer.role, key)) throw new ForbiddenError("dashboard:view");
  const { scope, timeframe } = effectiveOptions(prefs, key);
  const me = ctx.viewer.userId;
  const mine = scope === "mine";

  switch (key) {
    case "today": {
      const [inspections, others] = await Promise.all([
        ctx.inspectionEvents(),
        loadCalendarEvents({
          start: ctx.today,
          end: addDays(ctx.today, 1),
          layers: ["tasks", "reports", "realtors"],
          role: ctx.viewer.role,
          inspectorId: mine ? me : null,
          assigneeId: mine ? me : null,
          now: ctx.now,
        }),
      ]);
      const todays = inspections.filter((e) => e.day === ctx.today && (!mine || e.inspectorId === me));
      return { key, events: [...todays, ...others].sort(byTime) };
    }

    case "needsAttention":
      return { key, items: await loadAttention(ctx, { scope, hidden: prefs.hiddenAttention }) };

    case "snapshot":
      return { key, kpis: await loadKpis(ctx, prefs.kpis) };

    case "upcoming": {
      const span = timeframe === "next14" ? 14 : 7;
      const events = (await ctx.inspectionEvents()).filter((e) => e.type === "inspection" && (!mine || e.inspectorId === me));
      const days: UpcomingDay[] = [];
      for (let i = 1; i <= span; i++) {
        const day = addDays(ctx.today, i);
        const onDay = events.filter((e) => e.day === day);
        if (onDay.length === 0) continue;
        days.push({ day, inspections: onDay.length, needsAttention: onDay.filter((e) => e.warnings.length > 0).length, firstStart: onDay[0].start });
      }
      return { key, days, total: days.reduce((n, d) => n + d.inspections, 0), timeframe: timeframe ?? "next7" };
    }

    case "recentActivity":
      return { key, entries: await loadRecentActivity(ctx) };

    case "myTasks": {
      const tasks = (await ctx.openTasks()).filter((t) => !mine || t.assigneeId === me);
      return { key, rows: tasks.slice(0, LIST_LIMIT).map((t) => taskRow(t, ctx)), total: tasks.length };
    }

    case "reportsPending": {
      const rows = (await ctx.unfinishedReports()).filter((r) => !mine || r.inspectorId === me);
      const total = mine ? rows.length : await ctx.unfinishedReportCount();
      return {
        key,
        total,
        rows: rows.slice(0, LIST_LIMIT).flatMap((r) => {
          // Same rule as Needs Attention, so the two never disagree.
          const item = reportAttention([r], ctx.today, ctx.config.reportDueDays, ctx.config.timeZone)[0];
          if (!item) return [];
          const inspected = r.completedAt ?? r.scheduledAt;
          return [
            {
              inspectionId: r.id,
              reportId: r.reports[0]?.id ?? null,
              address: item.subject,
              inspectedOn: inspected ? toDayKey(inspected, ctx.config.timeZone) : null,
              statusLabel: item.title,
              overdue: item.overdue,
              inspectorName: r.inspector?.name ?? null,
              href: item.href,
            },
          ];
        }),
      };
    }

    case "outstandingInvoices": {
      const invoices = await ctx.collectibleInvoices();
      const rows: InvoiceRow[] = invoices.map((inv) => {
        const due = inv.dueAt ? toDayKey(inv.dueAt, ctx.config.timeZone) : null;
        return { id: inv.id, invoiceNumber: inv.invoiceNumber, customer: inv.customer, balance: inv.balance.toFixed(2), due, overdue: due !== null && due < ctx.today, href: `/transactions/${inv.transactionId}` };
      });
      rows.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
      const balance = invoices.reduce((sum, inv) => sum + Number(inv.balance.toString()), 0);
      return { key, rows: rows.slice(0, LIST_LIMIT), total: rows.length, balance: balance.toFixed(2) };
    }

    case "realtorFollowUps": {
      const tasks = (await ctx.openTasks()).filter((t) => t.realtor && (!mine || t.assigneeId === me));
      return { key, rows: tasks.slice(0, LIST_LIMIT).map((t) => taskRow(t, ctx)), total: tasks.length };
    }

    case "leadActivity": {
      const period = timeframe === "month" ? monthPeriod(ctx.today, ctx.config.timeZone) : weekPeriod(ctx.today, ctx.config.timeZone, ctx.config.weekStartsOn);
      const range = { gte: period.start, lt: period.end };
      const [created, converted, recent] = await Promise.all([
        prisma.lead.count({ where: { createdAt: range } }),
        prisma.lead.count({ where: { convertedAt: range } }),
        prisma.lead.findMany({
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, firstName: true, lastName: true, status: true, createdAt: true, referralSource: { select: { name: true } } },
        }),
      ]);
      return {
        key,
        timeframe: timeframe ?? "week",
        created,
        converted,
        recent: recent.map((l) => ({ id: l.id, name: `${l.firstName} ${l.lastName}`, status: l.status, source: l.referralSource?.name ?? null, createdDay: toDayKey(l.createdAt, ctx.config.timeZone) })),
      };
    }
  }
}

export interface DashboardData {
  today: string;
  widgets: Partial<Record<WidgetKey, WidgetResult>>;
}

export async function loadDashboard(viewer: DashboardViewer, prefs: DashboardPreferences, now = new Date()): Promise<DashboardData> {
  const ctx = createDashboardContext(viewer, now);
  const keys = visibleWidgets(prefs);
  const results = await Promise.all(
    keys.map(async (key): Promise<WidgetResult> => {
      try {
        return await loadWidget(key, ctx, prefs);
      } catch (err) {
        if (err instanceof ForbiddenError) return { key, error: "You don't have access to this widget." };
        console.error(`[dashboard] ${key} failed to load:`, err instanceof Error ? err.message : err);
        return { key, error: "This section couldn't load. Refresh to try again." };
      }
    })
  );
  return { today: ctx.today, widgets: Object.fromEntries(results.map((r) => [r.key, r])) };
}
