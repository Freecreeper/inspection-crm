import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/rbac";
import { getCalendarConfig, type CalendarConfig } from "@/lib/calendar/config";
import { loadCalendarEvents } from "@/lib/calendar/events";
import { addDays, startOfDayUtc, toDayKey, type DayKey } from "@/lib/calendar/time";
import type { CalendarEvent } from "@/lib/calendar/types";
import { invoiceTotals, isInvoiceCollectible } from "@/lib/invoices";

// The records several Dashboard widgets share, each loaded at most once per
// request and only when something visible asks for it — so hiding a widget
// also skips its queries. Every query is bounded (date range and/or take).

export interface DashboardViewer {
  userId: string;
  role: Role;
}

// Inspections are looked at from today through this many days ahead:
// Today, Upcoming (up to 14 days after today), and the scheduling rules
// in Needs Attention all read the same window.
export const INSPECTION_WINDOW_DAYS = 15;

// Reports: an inspection's report is "finished" once finalized or delivered.
export const FINISHED_REPORT_STATUSES = ["FINALIZED", "DELIVERED", "ARCHIVED"] as const;
export const COLLECTIBLE_INVOICE_STATUSES = ["SENT", "PARTIALLY_PAID", "OVERDUE"] as const;

export function unfinishedReportWhere(inspectorId?: string | null): Prisma.InspectionWhereInput {
  return {
    status: "COMPLETED",
    reports: { none: { status: { in: [...FINISHED_REPORT_STATUSES] } } },
    ...(inspectorId ? { inspectorId } : {}),
  };
}

export interface UnfinishedReport {
  id: string;
  scheduledAt: Date | null;
  completedAt: Date | null;
  inspectorId: string | null;
  inspector: { name: string } | null;
  property: { addressLine1: string; city: string };
  reports: { id: string; status: string }[];
}

export interface CollectibleInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  dueAt: Date | null;
  transactionId: string;
  customer: string | null;
  balance: Prisma.Decimal;
}

export interface OpenTask {
  id: string;
  title: string;
  dueAt: Date | null;
  completedAt: Date | null;
  assigneeId: string | null;
  assignee: { name: string } | null;
  realtor: { id: string; firstName: string; lastName: string; preferredName: string | null; phone: string | null } | null;
  transaction: { id: string; property: { addressLine1: string; city: string } | null } | null;
}

export interface DashboardContext {
  viewer: DashboardViewer;
  now: Date;
  config: CalendarConfig;
  today: DayKey;
  startOfToday: Date;
  inspectionEvents: () => Promise<CalendarEvent[]>;
  unfinishedReports: () => Promise<UnfinishedReport[]>;
  unfinishedReportCount: () => Promise<number>;
  collectibleInvoices: () => Promise<CollectibleInvoice[]>;
  // Open tasks that are overdue or due within the next week.
  openTasks: () => Promise<OpenTask[]>;
}

function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => (promise ??= load());
}

export const TASK_WINDOW_DAYS = 7;

export function createDashboardContext(viewer: DashboardViewer, now = new Date()): DashboardContext {
  const config = getCalendarConfig();
  const today = toDayKey(now, config.timeZone);
  const startOfToday = startOfDayUtc(today, config.timeZone);

  return {
    viewer,
    now,
    config,
    today,
    startOfToday,

    inspectionEvents: lazy(() =>
      loadCalendarEvents({ start: today, end: addDays(today, INSPECTION_WINDOW_DAYS), layers: ["inspections"], role: viewer.role, now })
    ),

    unfinishedReports: lazy(() =>
      prisma.inspection.findMany({
        where: unfinishedReportWhere(),
        orderBy: [{ completedAt: "asc" }, { scheduledAt: "asc" }],
        take: 50,
        select: {
          id: true,
          scheduledAt: true,
          completedAt: true,
          inspectorId: true,
          inspector: { select: { name: true } },
          property: { select: { addressLine1: true, city: true } },
          reports: { select: { id: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      })
    ),
    unfinishedReportCount: lazy(() => prisma.inspection.count({ where: unfinishedReportWhere() })),

    collectibleInvoices: lazy(async () => {
      // Defense in depth: callers already check, but money never leaves
      // this function for a role without financial access.
      assertCan(viewer.role, "financial:read");
      const rows = await prisma.invoice.findMany({
        where: { status: { in: [...COLLECTIBLE_INVOICE_STATUSES] } },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        take: 500,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          dueAt: true,
          transactionId: true,
          items: { select: { amount: true } },
          payments: { select: { amount: true } },
          transaction: { select: { customers: { select: { primaryContact: true, customer: { select: { firstName: true, lastName: true } } } } } },
        },
      });
      return rows
        .map((inv) => {
          const c = (inv.transaction.customers.find((r) => r.primaryContact) ?? inv.transaction.customers[0])?.customer;
          return {
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            status: inv.status,
            dueAt: inv.dueAt,
            transactionId: inv.transactionId,
            customer: c ? `${c.firstName} ${c.lastName}` : null,
            balance: invoiceTotals(inv).balance,
          };
        })
        .filter((inv) => isInvoiceCollectible(inv.status as never, inv.balance));
    }),

    openTasks: lazy(() =>
      prisma.task.findMany({
        where: { completedAt: null, dueAt: { lt: startOfDayUtc(addDays(today, TASK_WINDOW_DAYS + 1), config.timeZone) } },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        take: 200,
        select: {
          id: true,
          title: true,
          dueAt: true,
          completedAt: true,
          assigneeId: true,
          assignee: { select: { name: true } },
          realtor: { select: { id: true, firstName: true, lastName: true, preferredName: true, phone: true } },
          transaction: { select: { id: true, property: { select: { addressLine1: true, city: true } } } },
        },
      })
    ),
  };
}
