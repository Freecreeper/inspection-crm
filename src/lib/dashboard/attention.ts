import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, formatDay, formatTime, timeOfDay, toDayKey, type DayKey } from "@/lib/calendar/time";
import type { CalendarEvent } from "@/lib/calendar/types";
import { formatMoney } from "@/lib/invoices";
import { realtorDisplayName } from "@/lib/realtors/display";
import { OPTIONAL_ATTENTION, REQUIRED_ATTENTION, canSeeAttention, type AttentionCategory, type OptionalAttentionCategory, type Scope } from "./registry";
import { FINISHED_REPORT_STATUSES, type CollectibleInvoice, type DashboardContext, type OpenTask, type UnfinishedReport } from "./sources";
import type { AttentionItem, AttentionSeverity } from "./types";

// Needs Attention: deterministic business rules over authoritative records.
// Each rule is a pure function (records in → items out), so "does this
// condition still hold?" is answered from the record itself — once an
// agreement is signed, an invoice paid, or a task completed, the rule
// simply stops producing the item. Nothing is stored; nothing is guessed.

// How far ahead scheduling problems are raised.
export const SCHEDULING_HORIZON_DAYS = 14;
export const AGREEMENT_HORIZON_DAYS = 7;
// Failed operational emails older than this are history, not attention.
export const EMAIL_FAILURE_LOOKBACK_DAYS = 14;

const REQUIRED = new Set<string>(REQUIRED_ATTENTION.map((c) => c.key));

function item(i: Omit<AttentionItem, "required" | "occurredAt" | "detail" | "preview" | "overdue"> & Partial<AttentionItem>): AttentionItem {
  return { detail: null, preview: null, overdue: false, occurredAt: null, ...i, required: REQUIRED.has(i.category) };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// Scheduling: conflicts, missing inspector, unsigned agreement — the same
// readiness warnings the Calendar shows, for inspections still ahead.
export function inspectionAttention(events: CalendarEvent[], today: DayKey, timeZone: string): AttentionItem[] {
  const out: AttentionItem[] = [];
  const horizon = addDays(today, SCHEDULING_HORIZON_DAYS);
  for (const e of events) {
    if (e.type !== "inspection" || (e.status !== "SCHEDULED" && e.status !== "IN_PROGRESS")) continue;
    if (e.day < today || e.day > horizon) continue;
    const when = `${e.day === today ? "Today" : formatDay(e.day, "short")}${e.start ? ` · ${formatTime(new Date(e.start), timeZone)}` : ""}`;
    const base = { sourceType: "Inspection", sourceId: e.sourceId, subject: e.title, dueAt: e.start, href: e.href, preview: { type: "inspection" as const, id: e.sourceId } };
    for (const w of e.warnings) {
      if (w.code === "conflict") {
        out.push(item({ ...base, id: `conflict:${e.sourceId}`, category: "conflict", severity: "critical", title: "Scheduling conflict", detail: `${when}${e.inspectorName ? ` · ${e.inspectorName}` : ""}`, actionLabel: "Review" }));
      } else if (w.code === "noInspector") {
        out.push(item({ ...base, id: `noInspector:${e.sourceId}`, category: "noInspector", severity: "warning", title: "No inspector assigned", detail: when, actionLabel: "Assign" }));
      } else if (w.code === "agreementUnsigned" && e.day <= addDays(today, AGREEMENT_HORIZON_DAYS)) {
        const soon = e.day <= addDays(today, 1);
        out.push(item({ ...base, id: `agreement:${e.sourceId}`, category: "agreementUnsigned", severity: soon ? "warning" : "action", title: "Agreement unsigned", detail: when, actionLabel: "Review" }));
      }
    }
  }
  return out;
}

const REVIEW_STATUSES = new Set(["REVIEW_REQUIRED", "READY_FOR_REVIEW"]);

// Completed inspection whose report isn't finalized (or delivered).
export function reportAttention(rows: UnfinishedReport[], today: DayKey, reportDueDays: number, timeZone: string): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const r of rows) {
    const latest = r.reports[0] ?? null;
    if (latest && (FINISHED_REPORT_STATUSES as readonly string[]).includes(latest.status)) continue;
    const inspected = r.completedAt ?? r.scheduledAt;
    const day = inspected ? toDayKey(inspected, timeZone) : null;
    const due = day ? addDays(day, reportDueDays) : null;
    const overdue = due !== null && due < today;
    const [title, actionLabel] = !latest ? ["Report not started", "Start report"] : REVIEW_STATUSES.has(latest.status) ? ["Report awaiting review", "Open report"] : ["Report not finalized", "Open report"];
    out.push(
      item({
        id: `report:${r.id}`,
        category: "reportUnfinished",
        severity: overdue ? "warning" : "action",
        title,
        subject: `${r.property.addressLine1}, ${r.property.city}`,
        detail: [day ? `Inspected ${formatDay(day, "short")}` : null, due ? (overdue ? `was due ${formatDay(due, "short")}` : `due ${formatDay(due, "short")}`) : null, r.inspector?.name].filter(Boolean).join(" · "),
        sourceType: latest ? "InspectionReport" : "Inspection",
        sourceId: latest?.id ?? r.id,
        dueAt: due,
        overdue,
        actionLabel,
        href: latest ? `/inspections/${r.id}/report` : `/inspections/${r.id}`,
      })
    );
  }
  return out;
}

export interface FailedDelivery {
  id: string;
  recipientName: string;
  report: {
    id: string;
    inspectionId: string;
    status: string;
    deliveredAt: Date | null;
    deliveries: { status: string }[];
    inspection: { inspectorId: string | null; property: { addressLine1: string; city: string } };
  };
}

// A report delivery failed and nothing has reached anyone since.
export function deliveryAttention(rows: FailedDelivery[]): AttentionItem[] {
  const seen = new Set<string>();
  const out: AttentionItem[] = [];
  for (const d of rows) {
    const r = d.report;
    if (seen.has(r.id)) continue;
    if (r.deliveredAt || r.status === "DELIVERED" || r.deliveries.some((x) => x.status === "SENT" || x.status === "VIEWED")) continue;
    seen.add(r.id);
    out.push(
      item({
        id: `delivery:${r.id}`,
        category: "deliveryFailed",
        severity: "critical",
        title: "Report delivery failed",
        subject: `${r.inspection.property.addressLine1}, ${r.inspection.property.city}`,
        detail: `To ${d.recipientName}`,
        sourceType: "InspectionReport",
        sourceId: r.id,
        dueAt: null,
        actionLabel: "Review",
        href: `/inspections/${r.inspectionId}/report/versions`,
      })
    );
  }
  return out;
}

export interface FailedEmail {
  id: string;
  status: string;
  subject: string;
  recipientName: string;
  statusReason: string | null;
  updatedAt: Date;
  automation: { name: string } | null;
  inspection: { inspectorId: string | null } | null;
}

// Operational (transactional) email that failed or bounced, and hasn't
// been retried since. Relationship/marketing mail isn't raised here.
export function emailAttention(rows: FailedEmail[]): AttentionItem[] {
  return rows
    .filter((m) => m.status === "FAILED" || m.status === "BOUNCED")
    .map((m) =>
      item({
        id: `email:${m.id}`,
        category: "emailFailed",
        severity: "warning",
        title: m.status === "BOUNCED" ? "Email bounced" : "Email failed",
        subject: m.automation?.name ?? m.subject,
        detail: [`To ${m.recipientName}`, m.statusReason].filter(Boolean).join(" · "),
        sourceType: "EmailMessage",
        sourceId: m.id,
        dueAt: null,
        occurredAt: m.updatedAt.toISOString(),
        actionLabel: "Review",
        href: `/email/messages/${m.id}`,
      })
    );
}

// Issued invoice past its due date with money still owed.
export function invoiceAttention(rows: CollectibleInvoice[], startOfToday: Date, timeZone: string): AttentionItem[] {
  return rows
    .filter((inv) => inv.dueAt && inv.dueAt < startOfToday && inv.balance.greaterThan(0) && inv.status !== "PAID" && inv.status !== "VOID")
    .map((inv) =>
      item({
        id: `invoice:${inv.id}`,
        category: "invoiceOverdue",
        severity: "action",
        title: "Payment overdue",
        subject: `${inv.customer ?? `Invoice ${inv.invoiceNumber}`} • ${formatMoney(inv.balance)}`,
        detail: `Invoice ${inv.invoiceNumber} · due ${formatDay(toDayKey(inv.dueAt!, timeZone), "short")}`,
        sourceType: "Invoice",
        sourceId: inv.id,
        dueAt: inv.dueAt!.toISOString(),
        overdue: true,
        actionLabel: "View invoice",
        href: `/transactions/${inv.transactionId}`,
      })
    );
}

// Overdue tasks, and Realtor follow-ups due today or earlier. Both come
// from the one Task table — a follow-up is a Task linked to a Realtor.
export function taskAttention(tasks: OpenTask[], today: DayKey, timeZone: string): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const t of tasks) {
    if (t.completedAt || !t.dueAt) continue;
    const day = toDayKey(t.dueAt, timeZone);
    const overdue = day < today;
    const base = { sourceType: "Task", sourceId: t.id, dueAt: day, overdue, preview: { type: "task" as const, id: t.id } };
    if (t.realtor) {
      if (day > today) continue;
      out.push(
        item({
          ...base,
          id: `followUp:${t.id}`,
          category: "realtorFollowUp",
          severity: overdue ? "action" : "info",
          title: overdue ? "Realtor follow-up overdue" : "Realtor follow-up due today",
          subject: realtorDisplayName(t.realtor),
          detail: t.title,
          actionLabel: "Contact",
          href: `/realtors/${t.realtor.id}`,
        })
      );
    } else if (overdue) {
      out.push(
        item({
          ...base,
          id: `task:${t.id}`,
          category: "taskOverdue",
          severity: "action",
          title: "Task overdue",
          subject: t.title,
          detail: [`Due ${formatDay(day, "short")}`, t.assignee?.name].filter(Boolean).join(" · "),
          actionLabel: "Open",
          href: t.transaction ? `/transactions/${t.transaction.id}` : "/tasks",
        })
      );
    }
  }
  return out;
}

export function emailReviewAttention(count: number): AttentionItem[] {
  if (count <= 0) return [];
  return [
    item({
      id: "emailReview",
      category: "emailReview",
      severity: "info",
      title: "Emails waiting for review",
      subject: `${count} email${count === 1 ? "" : "s"} prepared by automations`,
      sourceType: "EmailMessage",
      sourceId: "review",
      dueAt: null,
      actionLabel: "Review",
      href: "/email/review",
    }),
  ];
}

// ---------------------------------------------------------------------------
// Ordering: immediate operational impact → overdue → due date → severity →
// recency. Fixed and explainable; never a model's guess.
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<AttentionSeverity, number> = { critical: 0, warning: 1, action: 2, info: 3 };

export function sortAttention(items: AttentionItem[], today: DayKey, timeZone: string): AttentionItem[] {
  const impact = (i: AttentionItem) => {
    if (i.severity === "critical") return 0;
    // Something wrong with an inspection happening today.
    if (i.preview?.type === "inspection" && i.dueAt && toDayKey(new Date(i.dueAt), timeZone) === today) return 1;
    return 2;
  };
  // Due values are ISO instants or day keys; compare as business-zone
  // "YYYY-MM-DDTHH:MM". Undated items sort last.
  const dueDay = (i: AttentionItem) => {
    if (!i.dueAt) return "9999";
    if (i.dueAt.length === 10) return `${i.dueAt}T00:00`;
    const d = new Date(i.dueAt);
    return `${toDayKey(d, timeZone)}T${timeOfDay(d, timeZone)}`;
  };
  return [...items].sort(
    (a, b) =>
      impact(a) - impact(b) ||
      Number(b.overdue) - Number(a.overdue) ||
      dueDay(a).localeCompare(dueDay(b)) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "") ||
      a.id.localeCompare(b.id)
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface AttentionOptions {
  scope: Scope;
  hidden: OptionalAttentionCategory[];
}

export function attentionCategories(ctx: DashboardContext, opts: AttentionOptions): Set<AttentionCategory> {
  const all = [...REQUIRED_ATTENTION.map((c) => c.key), ...OPTIONAL_ATTENTION.map((c) => c.key)] as AttentionCategory[];
  return new Set(
    all.filter((c) => {
      if (!canSeeAttention(ctx.viewer.role, c)) return false;
      if ((opts.hidden as string[]).includes(c) && !REQUIRED.has(c)) return false;
      // "My items" is about work assigned to me: business-wide queues
      // (invoices, the email review queue) belong to "All items".
      if (opts.scope === "mine" && (c === "invoiceOverdue" || c === "emailReview")) return false;
      return true;
    })
  );
}

const failedDeliverySelect = {
  id: true,
  recipientName: true,
  report: {
    select: {
      id: true,
      inspectionId: true,
      status: true,
      deliveredAt: true,
      deliveries: { select: { status: true } },
      inspection: { select: { inspectorId: true, property: { select: { addressLine1: true, city: true } } } },
    },
  },
} satisfies Prisma.ReportDeliverySelect;

export async function loadAttention(ctx: DashboardContext, opts: AttentionOptions): Promise<AttentionItem[]> {
  const cats = attentionCategories(ctx, opts);
  const me = ctx.viewer.userId;
  const mine = opts.scope === "mine";
  const { timeZone, reportDueDays } = ctx.config;
  const want = (...c: AttentionCategory[]) => c.some((x) => cats.has(x));

  const [events, reports, deliveries, emails, invoices, tasks, reviewCount] = await Promise.all([
    want("conflict", "noInspector", "agreementUnsigned") ? ctx.inspectionEvents() : [],
    want("reportUnfinished") ? ctx.unfinishedReports() : [],
    want("deliveryFailed")
      ? prisma.reportDelivery.findMany({
          where: { status: "FAILED", report: { deliveredAt: null, deliveries: { none: { status: { in: ["SENT", "VIEWED"] } } } } },
          orderBy: { accessExpiresAt: "desc" },
          take: 20,
          select: failedDeliverySelect,
        })
      : [],
    want("emailFailed")
      ? prisma.emailMessage.findMany({
          where: {
            status: { in: ["FAILED", "BOUNCED"] },
            category: "TRANSACTIONAL",
            updatedAt: { gte: new Date(ctx.now.getTime() - EMAIL_FAILURE_LOOKBACK_DAYS * 86_400_000) },
            // A failed report email already shows as a failed delivery.
            NOT: { status: "FAILED", reportDeliveryId: { not: null } },
          },
          orderBy: { updatedAt: "desc" },
          take: 20,
          select: { id: true, status: true, subject: true, recipientName: true, statusReason: true, updatedAt: true, automation: { select: { name: true } }, inspection: { select: { inspectorId: true } } },
        })
      : [],
    want("invoiceOverdue") ? ctx.collectibleInvoices() : [],
    want("taskOverdue", "realtorFollowUp") ? ctx.openTasks() : [],
    want("emailReview") ? prisma.emailMessage.count({ where: { status: "DRAFT", mode: "REVIEW", campaignId: null } }) : 0,
  ]);

  const items = [
    ...inspectionAttention(mine ? events.filter((e) => e.inspectorId === me) : events, ctx.today, timeZone),
    ...reportAttention(mine ? reports.filter((r) => r.inspectorId === me) : reports, ctx.today, reportDueDays, timeZone),
    ...deliveryAttention(mine ? deliveries.filter((d) => d.report.inspection.inspectorId === me) : deliveries),
    ...emailAttention(mine ? emails.filter((m) => m.inspection?.inspectorId === me) : emails),
    ...invoiceAttention(invoices, ctx.startOfToday, timeZone),
    ...taskAttention(mine ? tasks.filter((t) => t.assigneeId === me) : tasks, ctx.today, timeZone),
    ...emailReviewAttention(reviewCount),
  ].filter((i) => cats.has(i.category));

  return sortAttention(items, ctx.today, timeZone);
}
