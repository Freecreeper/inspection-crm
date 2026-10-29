// Server-only. One loader per board widget, each returning urgent items in
// the shared BoardItem shape. They're built on the Dashboard's data context
// (src/lib/dashboard/sources.ts) and Needs-attention rules, so the business
// rules — report due days, agreement horizon, failed deliveries, what makes
// a task overdue — live in one place, and a board with many tiles still runs
// each underlying query once (the context memoizes per request).

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { addDays, dateOnlyKey, startOfDayUtc, toDayKey } from "@/lib/calendar/time";
import { formatMoney } from "@/lib/invoices";
import { realtorDisplayName } from "@/lib/realtors/display";
import { loadAttention } from "@/lib/dashboard/attention";
import type { DashboardContext, OpenTask } from "@/lib/dashboard/sources";
import type { AttentionCategory } from "@/lib/dashboard/registry";
import type { AttentionItem } from "@/lib/dashboard/types";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { Scope, TileWindow, WidgetKey } from "./catalog";
import { dueLabel, fromAttention, inWindow, severityFor, sortItems, type BoardItem, type Clock, type Headline, type ItemAction } from "./items";

export const ITEM_LIMIT = 8;
const STUCK_LEAD_DAYS = 7;
const NEW_LEAD_GRACE_HOURS = 24;
const EMAIL_LOOKBACK_DAYS = 14;

export interface BoardContext {
  dashboard: DashboardContext;
  clock: Clock;
  role: Role;
  userId: string;
  // Needs-attention items, loaded once per scope per request.
  attention: (scope: Scope) => Promise<AttentionItem[]>;
}

export function createBoardContext(dashboard: DashboardContext, clock: Clock): BoardContext {
  const cache = new Map<Scope, Promise<AttentionItem[]>>();
  return {
    dashboard,
    clock,
    role: dashboard.viewer.role,
    userId: dashboard.viewer.userId,
    attention: (scope) => {
      let p = cache.get(scope);
      if (!p) cache.set(scope, (p = loadAttention(dashboard, { scope, hidden: [] })));
      return p;
    },
  };
}

export interface LoadedWidget {
  headline: Headline;
  items: BoardItem[];
  total: number;
}

const count = (n: number, one: string, many = `${one}s`) => ({ value: String(n), label: n === 1 ? one : many });

function finish(items: BoardItem[], window: TileWindow | null, clock: Clock, label: [string, string?]): LoadedWidget {
  const kept = sortItems(window ? items.filter((i) => inWindow(i, window, clock)) : items, clock);
  return { headline: count(kept.length, label[0], label[1]), items: kept.slice(0, ITEM_LIMIT), total: kept.length };
}

async function attentionOf(ctx: BoardContext, scope: Scope, ...cats: AttentionCategory[]): Promise<BoardItem[]> {
  return (await ctx.attention(scope)).filter((a) => cats.includes(a.category)).map((a) => fromAttention(a, ctx.clock));
}

// ---- tasks -----------------------------------------------------------------

function taskItem(t: OpenTask, ctx: BoardContext): BoardItem {
  // Task due dates are dates: read them as business-zone days, the same way
  // the Needs-attention rules do.
  const day = t.dueAt ? toDayKey(t.dueAt, ctx.clock.timeZone) : null;
  const where = t.realtor ? realtorDisplayName(t.realtor) : t.transaction?.property ? `${t.transaction.property.addressLine1}, ${t.transaction.property.city}` : null;
  const href = t.realtor ? `/realtors/${t.realtor.id}` : t.transaction ? `/transactions/${t.transaction.id}` : "/tasks";
  const actions: ItemAction[] = [];
  if (can(ctx.role, "task:update")) {
    actions.push({ kind: "completeTask", label: "Complete", taskId: t.id });
    actions.push({ kind: "snoozeTask", label: "Tomorrow", taskId: t.id, until: addDays(ctx.clock.today, 1) });
  }
  if (t.realtor?.phone) actions.push({ kind: "call", label: "Call", phone: t.realtor.phone });
  if (t.realtor?.email) actions.push({ kind: "email", label: "Email", email: t.realtor.email });
  actions.push({ kind: "open", label: "Open", href });
  return {
    id: `task:${t.id}`,
    title: t.title,
    subtitle: [where, t.assignee?.name].filter(Boolean).join(" · ") || null,
    due: day,
    dueLabel: dueLabel(day, ctx.clock),
    severity: severityFor(day, ctx.clock),
    href,
    actions,
  };
}

// ---- inspections -----------------------------------------------------------

function inspectionItem(e: CalendarEvent, ctx: BoardContext): BoardItem {
  const due = e.start ?? e.day;
  return {
    id: `inspection:${e.sourceId}`,
    title: e.title,
    subtitle: [e.subtitle, e.inspectorName ?? "Unassigned"].filter(Boolean).join(" · ") || null,
    due,
    dueLabel: dueLabel(due, ctx.clock)?.replace(/^Overdue · /, "") ?? null,
    // An inspection later today is "today"; one in the next 48 hours "soon".
    severity: e.day === ctx.clock.today ? "today" : severityFor(due, ctx.clock) === "overdue" ? "today" : severityFor(due, ctx.clock),
    href: e.href,
    actions: [{ kind: "open", label: "Open", href: e.href }],
  };
}

async function inspectionEvents(ctx: BoardContext, scope: Scope): Promise<CalendarEvent[]> {
  const events = await ctx.dashboard.inspectionEvents();
  return events.filter((e) => e.type === "inspection" && (e.status === "SCHEDULED" || e.status === "IN_PROGRESS") && (scope === "all" || e.inspectorId === ctx.userId));
}

// ---- the loaders -------------------------------------------------------------

type Loader = (ctx: BoardContext, opts: { scope: Scope; window: TileWindow }) => Promise<LoadedWidget>;

const LOADERS: Record<Exclude<WidgetKey, "smartStack">, Loader> = {
  async needsAttention(ctx, { scope }) {
    const items = (await ctx.attention(scope)).map((a) => fromAttention(a, ctx.clock));
    return finish(items, null, ctx.clock, ["thing needs you", "things need you"]);
  },

  async focusDeck(ctx, { scope }) {
    const [attention, tasks] = await Promise.all([ctx.attention(scope), ctx.dashboard.openTasks({ assigneeId: scope === "mine" ? ctx.userId : null })]);
    // Attention covers overdue tasks; add today's so the deck has the day's work.
    const seen = new Set(attention.map((a) => a.sourceId));
    const todays = tasks.filter((t) => !seen.has(t.id)).map((t) => taskItem(t, ctx)).filter((i) => i.severity === "today");
    return finish([...attention.map((a) => fromAttention(a, ctx.clock)), ...todays], null, ctx.clock, ["item", "items"]);
  },

  async nextUp(ctx, { scope }) {
    const [events, tasks] = await Promise.all([inspectionEvents(ctx, scope), ctx.dashboard.openTasks({ assigneeId: scope === "mine" ? ctx.userId : null })]);
    const upcoming = events.filter((e) => e.start && new Date(e.end ?? e.start) > ctx.clock.now).map((e) => inspectionItem(e, ctx));
    const dueTasks = tasks.map((t) => taskItem(t, ctx)).filter((i) => i.severity === "today" || i.severity === "overdue");
    const items = sortItems([...upcoming, ...dueTasks], ctx.clock);
    const first = items[0];
    const headline = first ? { value: first.dueLabel?.replace(/^(Today|Overdue ·) ?/, "") || "Now", label: first.title } : { value: "—", label: "Nothing scheduled" };
    return { headline, items: items.slice(0, ITEM_LIMIT), total: items.length };
  },

  async timeline(ctx, { scope }) {
    const [events, tasks] = await Promise.all([inspectionEvents(ctx, scope), ctx.dashboard.openTasks({ assigneeId: scope === "mine" ? ctx.userId : null })]);
    const items = [...events.filter((e) => e.day === ctx.clock.today).map((e) => inspectionItem(e, ctx)), ...tasks.map((t) => taskItem(t, ctx)).filter((i) => i.severity === "today" || i.severity === "overdue")];
    return finish(items, "today", ctx.clock, ["item today", "items today"]);
  },

  async todaysInspections(ctx, { scope }) {
    const items = (await inspectionEvents(ctx, scope)).filter((e) => e.day === ctx.clock.today).map((e) => inspectionItem(e, ctx));
    return finish(items, null, ctx.clock, ["inspection today", "inspections today"]);
  },

  async upcomingInspections(ctx, { scope, window }) {
    const end = addDays(ctx.clock.today, window === "week" ? 7 : 2);
    const items = (await inspectionEvents(ctx, scope)).filter((e) => e.day > ctx.clock.today && e.day <= end).map((e) => inspectionItem(e, ctx));
    return finish(items, null, ctx.clock, ["coming up", "coming up"]);
  },

  async schedulingIssues(ctx, { scope, window }) {
    return finish(await attentionOf(ctx, scope, "conflict", "noInspector"), window, ctx.clock, ["issue", "issues"]);
  },

  async agreementsToSign(ctx, { scope, window }) {
    return finish(await attentionOf(ctx, scope, "agreementUnsigned"), window, ctx.clock, ["to sign", "to sign"]);
  },

  async reportsToFinish(ctx, { scope, window }) {
    return finish(await attentionOf(ctx, scope, "reportUnfinished"), window, ctx.clock, ["report", "reports"]);
  },

  async reportsToReview(ctx, { scope }) {
    const rows = await prisma.inspectionReport.findMany({
      where: { status: { in: ["REVIEW_REQUIRED", "READY_FOR_REVIEW"] }, ...(scope === "mine" ? { inspection: { inspectorId: ctx.userId } } : {}) },
      orderBy: { updatedAt: "asc" },
      take: ITEM_LIMIT,
      select: { id: true, inspectionId: true, updatedAt: true, inspection: { select: { property: { select: { addressLine1: true, city: true } }, inspector: { select: { name: true } } } } },
    });
    const total = await prisma.inspectionReport.count({ where: { status: { in: ["REVIEW_REQUIRED", "READY_FOR_REVIEW"] }, ...(scope === "mine" ? { inspection: { inspectorId: ctx.userId } } : {}) } });
    const items: BoardItem[] = rows.map((r) => ({
      id: `review:${r.id}`,
      title: `${r.inspection.property.addressLine1}, ${r.inspection.property.city}`,
      subtitle: r.inspection.inspector?.name ?? null,
      due: null,
      dueLabel: null,
      severity: "today",
      href: `/inspections/${r.inspectionId}/report/finalize`,
      actions: [{ kind: "open", label: "Review", href: `/inspections/${r.inspectionId}/report/finalize` }],
    }));
    return { headline: count(total, "to review", "to review"), items, total };
  },

  async readyToDeliver(ctx, { scope }) {
    const where = { status: { in: ["FINALIZED", "AMENDED"] as ("FINALIZED" | "AMENDED")[] }, deliveredAt: null, ...(scope === "mine" ? { inspection: { inspectorId: ctx.userId } } : {}) };
    const [rows, total, failed] = await Promise.all([
      prisma.inspectionReport.findMany({
        where,
        orderBy: { finalizedAt: "asc" },
        take: ITEM_LIMIT,
        select: { id: true, inspectionId: true, finalizedAt: true, inspection: { select: { property: { select: { addressLine1: true, city: true } } } } },
      }),
      prisma.inspectionReport.count({ where }),
      attentionOf(ctx, scope, "deliveryFailed"),
    ]);
    const ready: BoardItem[] = rows.map((r) => ({
      id: `deliver:${r.id}`,
      title: `${r.inspection.property.addressLine1}, ${r.inspection.property.city}`,
      subtitle: r.finalizedAt ? `Finalized ${dueLabel(r.finalizedAt.toISOString(), ctx.clock)?.replace(/^Overdue · /, "")}` : "Finalized",
      due: null,
      dueLabel: null,
      severity: "today",
      href: `/inspections/${r.inspectionId}/report`,
      actions: [{ kind: "open", label: "Deliver", href: `/inspections/${r.inspectionId}/report` }],
    }));
    const items = sortItems([...failed, ...ready], ctx.clock);
    return { headline: count(total + failed.length, "to deliver", "to deliver"), items: items.slice(0, ITEM_LIMIT), total: total + failed.length };
  },

  async unpaidInvoices(ctx, { window }) {
    const invoices = await ctx.dashboard.collectibleInvoices();
    const items: BoardItem[] = invoices
      .filter((inv) => inv.dueAt)
      .map((inv) => {
        const due = inv.dueAt!.toISOString();
        const href = `/transactions/${inv.transactionId}`;
        return {
          id: `invoice:${inv.id}`,
          title: `${inv.customer ?? `Invoice ${inv.invoiceNumber}`} · ${formatMoney(inv.balance)}`,
          subtitle: `Invoice ${inv.invoiceNumber}`,
          due,
          dueLabel: dueLabel(due, ctx.clock),
          severity: inv.dueAt! < ctx.dashboard.startOfToday ? "overdue" : severityFor(due, ctx.clock),
          href,
          actions: [{ kind: "open", label: "View invoice", href }],
        };
      });
    const result = finish(items, window, ctx.clock, ["invoice", "invoices"]);
    const balance = invoices.filter((inv) => result.items.some((i) => i.id === `invoice:${inv.id}`)).reduce((sum, inv) => sum.plus(inv.balance), invoices[0]?.balance.mul(0) ?? null);
    return balance && result.total > 0 ? { ...result, headline: { value: formatMoney(balance), label: `${result.total} unpaid` } } : result;
  },

  async tasksDue(ctx, { scope, window }) {
    const tasks = await ctx.dashboard.openTasks({ assigneeId: scope === "mine" ? ctx.userId : null });
    return finish(tasks.map((t) => taskItem(t, ctx)), window, ctx.clock, ["task", "tasks"]);
  },

  async followUpsDue(ctx, { scope, window }) {
    const tasks = await ctx.dashboard.openTasks({ assigneeId: scope === "mine" ? ctx.userId : null, realtorOnly: true });
    return finish(tasks.map((t) => taskItem(t, ctx)), window, ctx.clock, ["follow-up", "follow-ups"]);
  },

  async idleRealtors() {
    const where = { archivedAt: null, tasks: { none: { completedAt: null } } };
    const [rows, total] = await Promise.all([
      prisma.realtor.findMany({ where, orderBy: { updatedAt: "asc" }, take: ITEM_LIMIT, select: { id: true, firstName: true, lastName: true, preferredName: true, phone: true, email: true, brokerage: { select: { name: true } } } }),
      prisma.realtor.count({ where }),
    ]);
    const items: BoardItem[] = rows.map((r) => ({
      id: `idle:${r.id}`,
      title: realtorDisplayName(r),
      subtitle: r.brokerage?.name ?? null,
      due: null,
      dueLabel: null,
      severity: "info",
      href: `/realtors/${r.id}`,
      actions: [
        ...(r.phone ? [{ kind: "call" as const, label: "Call", phone: r.phone }] : []),
        ...(r.email ? [{ kind: "email" as const, label: "Email", email: r.email }] : []),
        { kind: "open" as const, label: "Open", href: `/realtors/${r.id}` },
      ],
    }));
    return { headline: count(total, "with no next action", "with no next action"), items, total };
  },

  async newReferrals(ctx) {
    const where = { archivedAt: null, referralSourceId: { not: null }, createdAt: { gte: new Date(ctx.clock.now.getTime() - 48 * 3_600_000) } };
    const [rows, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: ITEM_LIMIT,
        select: { id: true, createdAt: true, referralSource: { select: { name: true } }, property: { select: { addressLine1: true, city: true } } },
      }),
      prisma.transaction.count({ where }),
    ]);
    const items: BoardItem[] = rows.map((t) => ({
      id: `referral:${t.id}`,
      title: t.referralSource?.name ?? "Referral",
      subtitle: t.property ? `${t.property.addressLine1}, ${t.property.city}` : null,
      due: null,
      dueLabel: dueLabel(t.createdAt.toISOString(), ctx.clock)?.replace(/^Overdue · /, "") ?? null,
      severity: "info",
      href: `/transactions/${t.id}`,
      actions: [{ kind: "open", label: "Open", href: `/transactions/${t.id}` }],
    }));
    return { headline: count(total, "new referral", "new referrals"), items, total };
  },

  async newLeads(ctx) {
    const where = { status: "NEW" as const };
    const [rows, total] = await Promise.all([prisma.lead.findMany({ where, orderBy: { createdAt: "asc" }, take: ITEM_LIMIT }), prisma.lead.count({ where })]);
    const grace = ctx.clock.now.getTime() - NEW_LEAD_GRACE_HOURS * 3_600_000;
    const items: BoardItem[] = rows.map((l) => ({
      id: `lead:${l.id}`,
      title: `${l.firstName} ${l.lastName}`,
      subtitle: [l.email, l.phone].filter(Boolean).join(" · ") || null,
      due: null,
      dueLabel: `Added ${dueLabel(l.createdAt.toISOString(), ctx.clock)?.replace(/^Overdue · /, "")}`,
      // Waiting more than a day for first contact is late.
      severity: l.createdAt.getTime() < grace ? "overdue" : "today",
      href: `/leads/${l.id}`,
      actions: [
        ...(l.phone ? [{ kind: "call" as const, label: "Call", phone: l.phone }] : []),
        ...(l.email ? [{ kind: "email" as const, label: "Email", email: l.email }] : []),
        { kind: "open" as const, label: "Open", href: `/leads/${l.id}` },
      ],
    }));
    return { headline: count(total, "new lead", "new leads"), items: sortItems(items, ctx.clock), total };
  },

  async stuckLeads(ctx) {
    const where = { status: { in: ["CONTACTED", "QUALIFIED"] as ("CONTACTED" | "QUALIFIED")[] }, updatedAt: { lt: new Date(ctx.clock.now.getTime() - STUCK_LEAD_DAYS * 86_400_000) } };
    const [rows, total] = await Promise.all([prisma.lead.findMany({ where, orderBy: { updatedAt: "asc" }, take: ITEM_LIMIT }), prisma.lead.count({ where })]);
    const items: BoardItem[] = rows.map((l) => ({
      id: `stuck:${l.id}`,
      title: `${l.firstName} ${l.lastName}`,
      subtitle: `${l.status === "CONTACTED" ? "Contacted" : "Qualified"} · untouched since ${dueLabel(l.updatedAt.toISOString(), ctx.clock)?.replace(/^Overdue · /, "")}`,
      due: null,
      dueLabel: null,
      severity: "today",
      href: `/leads/${l.id}`,
      actions: [{ kind: "open", label: "Open", href: `/leads/${l.id}` }],
    }));
    return { headline: count(total, "stalled lead", "stalled leads"), items, total };
  },

  async dealDeadlines(ctx, { window }) {
    const end = new Date(startOfDayUtc(addDays(ctx.clock.today, window === "week" ? 8 : 3), ctx.clock.timeZone));
    const rows = await prisma.transaction.findMany({
      where: {
        archivedAt: null,
        status: { in: ["LEAD_IN_PROGRESS", "SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
        OR: [{ inspectionDeadline: { lt: end } }, { closingDate: { lt: end } }],
      },
      take: 50,
      select: { id: true, inspectionDeadline: true, closingDate: true, property: { select: { addressLine1: true, city: true } }, customers: { select: { primaryContact: true, customer: { select: { firstName: true, lastName: true } } } } },
    });
    const items: BoardItem[] = rows.flatMap((t) => {
      const c = (t.customers.find((x) => x.primaryContact) ?? t.customers[0])?.customer;
      const who = [c ? `${c.firstName} ${c.lastName}` : null, t.property ? `${t.property.addressLine1}, ${t.property.city}` : null].filter(Boolean).join(" · ") || null;
      const out: BoardItem[] = [];
      for (const [kind, date] of [["Inspection deadline", t.inspectionDeadline], ["Closing", t.closingDate]] as const) {
        if (!date || date >= end) continue;
        const day = dateOnlyKey(date)!;
        // Past deadlines only matter while they're recent (last week).
        if (day < addDays(ctx.clock.today, -7)) continue;
        out.push({ id: `${kind}:${t.id}`, title: kind, subtitle: who, due: day, dueLabel: dueLabel(day, ctx.clock), severity: severityFor(day, ctx.clock), href: `/transactions/${t.id}`, actions: [{ kind: "open", label: "Open", href: `/transactions/${t.id}` }] });
      }
      return out;
    });
    return finish(items, window, ctx.clock, ["deadline", "deadlines"]);
  },

  async customerFollowUps(ctx, { scope, window }) {
    const tasks = await prisma.task.findMany({
      where: {
        completedAt: null,
        dueAt: { lt: startOfDayUtc(addDays(ctx.clock.today, 8), ctx.clock.timeZone) },
        transaction: { archivedAt: null, customers: { some: { customer: { archivedAt: null } } } },
        ...(scope === "mine" ? { assigneeId: ctx.userId } : {}),
      },
      orderBy: { dueAt: "asc" },
      take: 50,
      select: {
        id: true,
        title: true,
        dueAt: true,
        completedAt: true,
        assigneeId: true,
        assignee: { select: { name: true } },
        transaction: { select: { id: true, property: { select: { addressLine1: true, city: true } }, customers: { select: { primaryContact: true, customer: { select: { firstName: true, lastName: true, phone: true, email: true } } } } } },
      },
    });
    const items = tasks.map((t) => {
      const base = taskItem({ ...t, realtor: null } as OpenTask, ctx);
      const c = (t.transaction!.customers.find((x) => x.primaryContact) ?? t.transaction!.customers[0])?.customer;
      if (!c) return base;
      const contact: ItemAction[] = [...(c.phone ? [{ kind: "call" as const, label: "Call", phone: c.phone }] : []), ...(c.email ? [{ kind: "email" as const, label: "Email", email: c.email }] : [])];
      return { ...base, subtitle: [`${c.firstName} ${c.lastName}`, base.subtitle].filter(Boolean).join(" · "), actions: [...base.actions.slice(0, -1), ...contact, base.actions.at(-1)!] };
    });
    return finish(items, window, ctx.clock, ["follow-up", "follow-ups"]);
  },

  async emailsToReview(ctx) {
    const where = { status: "DRAFT" as const, mode: "REVIEW" as const, campaignId: null };
    const [rows, total] = await Promise.all([
      prisma.emailMessage.findMany({ where, orderBy: { createdAt: "asc" }, take: ITEM_LIMIT, select: { id: true, subject: true, recipientName: true, createdAt: true, automation: { select: { name: true } } } }),
      prisma.emailMessage.count({ where }),
    ]);
    const items: BoardItem[] = rows.map((m) => ({
      id: `review-email:${m.id}`,
      title: m.subject,
      subtitle: [m.recipientName, m.automation?.name].filter(Boolean).join(" · ") || null,
      due: null,
      dueLabel: `Prepared ${dueLabel(m.createdAt.toISOString(), ctx.clock)?.replace(/^Overdue · /, "")}`,
      severity: "today",
      href: `/email/messages/${m.id}`,
      actions: [{ kind: "open", label: "Review", href: `/email/messages/${m.id}` }],
    }));
    return { headline: count(total, "to review", "to review"), items, total };
  },

  async failedEmails(ctx) {
    const where = { status: { in: ["FAILED", "BOUNCED"] as ("FAILED" | "BOUNCED")[] }, updatedAt: { gte: new Date(ctx.clock.now.getTime() - EMAIL_LOOKBACK_DAYS * 86_400_000) } };
    const [rows, total] = await Promise.all([
      prisma.emailMessage.findMany({ where, orderBy: { updatedAt: "desc" }, take: ITEM_LIMIT, select: { id: true, subject: true, recipientName: true, status: true, statusReason: true, updatedAt: true } }),
      prisma.emailMessage.count({ where }),
    ]);
    const items: BoardItem[] = rows.map((m) => ({
      id: `failed-email:${m.id}`,
      title: m.subject,
      subtitle: [m.recipientName, m.statusReason ?? (m.status === "BOUNCED" ? "Bounced" : "Failed")].filter(Boolean).join(" · ") || null,
      due: null,
      dueLabel: dueLabel(m.updatedAt.toISOString(), ctx.clock)?.replace(/^Overdue · /, "") ?? null,
      severity: "overdue",
      href: `/email/messages/${m.id}`,
      actions: [{ kind: "open", label: "Open", href: `/email/messages/${m.id}` }],
    }));
    return { headline: count(total, "failed", "failed"), items, total };
  },

  async scheduledSends(ctx, { window }) {
    const where = { status: "SCHEDULED" as const, scheduledFor: { lt: new Date(Math.max(ctx.clock.now.getTime() + 48 * 3_600_000, window === "week" ? ctx.clock.now.getTime() + 7 * 86_400_000 : 0)) } };
    const [rows, total] = await Promise.all([
      prisma.emailMessage.findMany({ where, orderBy: { scheduledFor: "asc" }, take: ITEM_LIMIT, select: { id: true, subject: true, recipientName: true, scheduledFor: true } }),
      prisma.emailMessage.count({ where }),
    ]);
    const items: BoardItem[] = rows.map((m) => {
      const due = m.scheduledFor?.toISOString() ?? null;
      return { id: `scheduled:${m.id}`, title: m.subject, subtitle: m.recipientName ?? null, due, dueLabel: dueLabel(due, ctx.clock)?.replace(/^Overdue · /, "") ?? null, severity: "soon", href: `/email/messages/${m.id}`, actions: [{ kind: "open", label: "Open", href: `/email/messages/${m.id}` }] };
    });
    return { headline: count(total, "scheduled", "scheduled"), items, total };
  },

  async tempPasswords() {
    const where = { active: true, mustChangePassword: true };
    const [rows, total] = await Promise.all([prisma.user.findMany({ where, orderBy: { name: "asc" }, take: ITEM_LIMIT, select: { id: true, name: true, email: true } }), prisma.user.count({ where })]);
    const items: BoardItem[] = rows.map((u) => ({ id: `user:${u.id}`, title: u.name, subtitle: u.email, due: null, dueLabel: null, severity: "info", href: "/settings/users", actions: [{ kind: "open", label: "Users", href: "/settings/users" }] }));
    return { headline: count(total, "on a temporary password", "on temporary passwords"), items, total };
  },
};

export function loaderFor(key: Exclude<WidgetKey, "smartStack">): Loader {
  return LOADERS[key];
}

