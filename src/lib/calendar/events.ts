import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { invoiceTotals, isInvoiceCollectible, formatMoney } from "@/lib/invoices";
import { realtorDisplayName } from "@/lib/realtors/display";
import { intervalsOverlap } from "@/lib/scheduling/conflicts";
import { MAX_DURATION } from "@/lib/scheduling/service";
import { getCalendarConfig, type CalendarConfig } from "./config";
import { readinessWarnings } from "./readiness";
import { addDays, dateOnlyKey, dayKeyToDateOnly, eachDay, startOfDayUtc, toDayKey, type DayKey } from "./time";
import type { CalendarLayer } from "./layers";
import type { CalendarEvent } from "./types";

// The Calendar's read side: one range-bounded query per enabled layer,
// each deriving CalendarEvents from the authoritative records. Nothing is
// copied into a calendar table, so an event can't disagree with its source.

export interface CalendarQuery {
  start: DayKey; // inclusive
  end: DayKey; // exclusive
  layers: CalendarLayer[];
  inspectorId?: string | null;
  // Tasks and follow-ups assigned to this user only (the Dashboard's "My"
  // filter). The Calendar itself doesn't use it.
  assigneeId?: string | null;
  role: Role | undefined;
  now?: Date;
}

type Loader = (q: Required<Pick<CalendarQuery, "start" | "end" | "role">> & CalendarQuery, ctx: Ctx) => Promise<CalendarEvent[]>;
interface Ctx {
  config: CalendarConfig;
  rangeStart: Date;
  rangeEnd: Date;
  now: Date;
}

// Primary contact, else the first customer on the deal.
function primaryOf<T>(rows: { primaryContact: boolean; customer: T }[]): T | null {
  return (rows.find((r) => r.primaryContact) ?? rows[0])?.customer ?? null;
}

const inRange = (day: DayKey, q: { start: DayKey; end: DayKey }) => day >= q.start && day < q.end;
const address = (p: { addressLine1: string; city: string } | null | undefined) => (p ? `${p.addressLine1}, ${p.city}` : null);

function base(e: Omit<CalendarEvent, "subtitle" | "start" | "end" | "inspectorId" | "inspectorName" | "status" | "priority" | "warnings" | "movable" | "searchText"> & Partial<CalendarEvent>): CalendarEvent {
  return {
    subtitle: null,
    start: null,
    end: null,
    inspectorId: null,
    inspectorName: null,
    status: null,
    priority: "normal",
    warnings: [],
    movable: false,
    ...e,
    searchText: (e.searchText ?? [e.title, e.subtitle].filter(Boolean).join(" ")).toLowerCase(),
  };
}

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------

const loadInspections: Loader = async (q, ctx) => {
  const canMove = can(q.role, "inspection:reschedule");
  const rows = await prisma.inspection.findMany({
    where: {
      status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
      // Anything that could still be running when the range opens.
      scheduledAt: { gte: new Date(ctx.rangeStart.getTime() - MAX_DURATION * 60_000), lt: ctx.rangeEnd },
      ...(q.inspectorId ? { inspectorId: q.inspectorId } : {}),
    },
    orderBy: { scheduledAt: "asc" },
    include: {
      property: { select: { addressLine1: true, city: true } },
      inspector: { select: { name: true } },
      inspectionServices: { select: { service: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      transaction: {
        select: {
          customers: { select: { primaryContact: true, customer: { select: { firstName: true, lastName: true, phone: true, email: true } } } },
          realtors: { select: { realtor: { select: { firstName: true, lastName: true, preferredName: true } } } },
          invoices: { select: { status: true, items: { select: { amount: true } }, payments: { select: { amount: true } } } },
        },
      },
    },
  });

  const events = rows
    .filter((i) => i.scheduledAt && new Date(i.scheduledAt.getTime() + i.durationMinutes * 60_000) > ctx.rangeStart)
    .map((i) => {
      const start = i.scheduledAt!;
      const end = new Date(start.getTime() + i.durationMinutes * 60_000);
      const customer = primaryOf(i.transaction.customers);
      const balanceDue = i.transaction.invoices.some((inv) => isInvoiceCollectible(inv.status, invoiceTotals(inv).balance));
      const services = i.inspectionServices.map((s) => s.service.name);
      return base({
        id: `inspection:${i.id}`,
        type: "inspection",
        layer: "inspections",
        sourceType: "Inspection",
        sourceId: i.id,
        title: address(i.property) ?? "Inspection",
        subtitle: services.length ? services.join(" + ") : "No services selected",
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: false,
        day: toDayKey(start, ctx.config.timeZone),
        inspectorId: i.inspectorId,
        inspectorName: i.inspector?.name ?? null,
        status: i.status,
        warnings: readinessWarnings({
          status: i.status,
          inspectorId: i.inspectorId,
          agreementSignedAt: i.agreementSignedAt,
          serviceCount: services.length,
          customer,
          balanceDue,
          requirePaymentBeforeInspection: ctx.config.requirePaymentBeforeInspection,
        }),
        href: `/inspections/${i.id}`,
        movable: canMove && i.status === "SCHEDULED",
        searchText: [
          address(i.property),
          ...services,
          customer ? `${customer.firstName} ${customer.lastName}` : null,
          ...i.transaction.realtors.map((r) => realtorDisplayName(r.realtor)),
          i.inspector?.name,
          i.id,
        ]
          .filter(Boolean)
          .join(" "),
      });
    });

  // Overlaps visible in this range, for the card warning. Saving is still
  // checked authoritatively (and under a lock) by the scheduling service.
  const active = events.filter((e) => e.inspectorId && (e.status === "SCHEDULED" || e.status === "IN_PROGRESS"));
  for (const a of active) {
    const clash = active.some(
      (b) => b !== a && b.inspectorId === a.inspectorId && intervalsOverlap(new Date(a.start!), new Date(a.end!), new Date(b.start!), new Date(b.end!))
    );
    if (clash) a.warnings.unshift({ code: "conflict", label: "Scheduling conflict" });
  }
  return events;
};

// ---------------------------------------------------------------------------
// Blocked time & appointments
// ---------------------------------------------------------------------------

const loadAppointments: Loader = async (q, ctx) => {
  const rows = await prisma.appointment.findMany({
    where: {
      cancelledAt: null,
      startAt: { lt: ctx.rangeEnd },
      endAt: { gt: ctx.rangeStart },
      ...(q.inspectorId ? { OR: [{ userId: q.inspectorId }, { userId: null, kind: "APPOINTMENT" }] } : {}),
    },
    orderBy: { startAt: "asc" },
    include: { user: { select: { name: true } } },
  });
  return rows.map((a) =>
    base({
      id: `appointment:${a.id}`,
      type: a.kind === "BLOCK" ? "block" : "appointment",
      layer: "appointments",
      sourceType: "Appointment",
      sourceId: a.id,
      title: a.title,
      subtitle: a.kind === "BLOCK" ? (a.user ? `${a.user.name} unavailable` : "Unavailable") : a.location,
      start: a.startAt.toISOString(),
      end: a.endAt.toISOString(),
      allDay: false,
      day: toDayKey(a.startAt, ctx.config.timeZone),
      inspectorId: a.userId,
      inspectorName: a.user?.name ?? null,
      href: a.transactionId ? `/transactions/${a.transactionId}` : "/calendar",
    })
  );
};

// ---------------------------------------------------------------------------
// Tasks and Realtor follow-ups (both are Task records; a follow-up is a task
// linked to a Realtor, so it lives on the Realtor layer instead)
// ---------------------------------------------------------------------------

const loadTasks =
  (which: "tasks" | "realtors"): Loader =>
  async (q, ctx) => {
    // Task due dates are calendar days (anchored at noon), so pad a day
    // either side of the range and bucket by business day.
    const rows = await prisma.task.findMany({
      where: {
        completedAt: null,
        dueAt: { gte: startOfDayUtc(addDays(q.start, -1), ctx.config.timeZone), lt: startOfDayUtc(addDays(q.end, 1), ctx.config.timeZone) },
        realtorId: which === "realtors" ? { not: null } : null,
        ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}),
      },
      orderBy: { dueAt: "asc" },
      include: {
        realtor: { select: { id: true, firstName: true, lastName: true, preferredName: true, brokerage: { select: { name: true } } } },
        transaction: { select: { id: true, property: { select: { addressLine1: true, city: true } } } },
        assignee: { select: { name: true } },
      },
    });
    const today = toDayKey(ctx.now, ctx.config.timeZone);
    return rows
      .map((t) => ({ t, day: toDayKey(t.dueAt!, ctx.config.timeZone) }))
      .filter(({ day }) => inRange(day, q))
      .map(({ t, day }) =>
        base({
          id: `task:${t.id}`,
          type: t.realtor ? "realtorFollowUp" : "task",
          layer: which,
          sourceType: "Task",
          sourceId: t.id,
          title: t.title,
          subtitle: t.realtor
            ? [realtorDisplayName(t.realtor), t.realtor.brokerage?.name].filter(Boolean).join(" · ")
            : (address(t.transaction?.property) ?? t.assignee?.name ?? null),
          allDay: true,
          day,
          inspectorName: t.assignee?.name ?? null,
          priority: day <= today ? "high" : "normal",
          href: t.realtor ? `/realtors/${t.realtor.id}` : t.transaction ? `/transactions/${t.transaction.id}` : "/tasks",
        })
      );
  };

// ---------------------------------------------------------------------------
// Report deadlines — derived from the inspection date; nothing is stored.
// Due = inspection day + reportDueDays, until the report is delivered.
// ---------------------------------------------------------------------------

const loadReportDeadlines: Loader = async (q, ctx) => {
  const days = ctx.config.reportDueDays;
  const rows = await prisma.inspection.findMany({
    where: {
      status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
      scheduledAt: {
        gte: startOfDayUtc(addDays(q.start, -days), ctx.config.timeZone),
        lt: startOfDayUtc(addDays(q.end, -days), ctx.config.timeZone),
      },
      reports: { none: { OR: [{ status: "DELIVERED" }, { deliveredAt: { not: null } }] } },
      ...(q.inspectorId ? { inspectorId: q.inspectorId } : {}),
    },
    orderBy: { scheduledAt: "asc" },
    include: {
      property: { select: { addressLine1: true, city: true } },
      reports: { select: { id: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
      inspector: { select: { name: true } },
    },
  });
  const today = toDayKey(ctx.now, ctx.config.timeZone);
  return rows
    .map((i) => ({ i, day: addDays(toDayKey(i.scheduledAt!, ctx.config.timeZone), days) }))
    .filter(({ day }) => inRange(day, q))
    .map(({ i, day }) =>
      base({
        id: `report:${i.id}`,
        type: "reportDue",
        layer: "reports",
        sourceType: i.reports[0] ? "InspectionReport" : "Inspection",
        sourceId: i.reports[0]?.id ?? i.id,
        title: `Report due · ${i.property.addressLine1}`,
        subtitle: i.reports[0] ? `Report ${i.reports[0].status.toLowerCase().replace(/_/g, " ")}` : "Report not started",
        allDay: true,
        day,
        inspectorId: i.inspectorId,
        inspectorName: i.inspector?.name ?? null,
        status: i.reports[0]?.status ?? null,
        priority: day <= today ? "high" : "normal",
        href: `/inspections/${i.id}/report`,
        searchText: `report ${address(i.property)} ${i.inspector?.name ?? ""}`,
      })
    );
};

// ---------------------------------------------------------------------------
// Transaction dates — date-only, shown as all-day, never time-shifted.
// ---------------------------------------------------------------------------

const loadTransactionDates: Loader = async (q) => {
  const range = { gte: dayKeyToDateOnly(q.start), lt: dayKeyToDateOnly(q.end) };
  const rows = await prisma.transaction.findMany({
    where: { archivedAt: null, status: { not: "CANCELLED" }, OR: [{ closingDate: range }, { inspectionDeadline: range }] },
    include: {
      property: { select: { addressLine1: true, city: true } },
      customers: { select: { primaryContact: true, customer: { select: { firstName: true, lastName: true } } } },
    },
  });
  const events: CalendarEvent[] = [];
  for (const t of rows) {
    const customer = primaryOf(t.customers);
    const who = customer ? `${customer.firstName} ${customer.lastName}` : null;
    const where = address(t.property) ?? "Transaction (no property yet)";
    const closing = dateOnlyKey(t.closingDate);
    const deadline = dateOnlyKey(t.inspectionDeadline);
    if (deadline && inRange(deadline, q)) {
      events.push(
        base({ id: `deadline:${t.id}`, type: "inspectionDeadline", layer: "transactions", sourceType: "Transaction", sourceId: t.id, title: `Inspection deadline · ${where}`, subtitle: who, allDay: true, day: deadline, priority: "high", href: `/transactions/${t.id}` })
      );
    }
    if (closing && inRange(closing, q)) {
      events.push(base({ id: `closing:${t.id}`, type: "closing", layer: "transactions", sourceType: "Transaction", sourceId: t.id, title: `Closing · ${where}`, subtitle: who, allDay: true, day: closing, href: `/transactions/${t.id}` }));
    }
  }
  return events;
};

// ---------------------------------------------------------------------------
// Realtor relationship dates. Missing dates produce nothing — never guessed.
// ---------------------------------------------------------------------------

function isLeapYear(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// Month/day → the day(s) in range it falls on. Feb 29 is observed on Feb 28
// in non-leap years (the same rule the birthday email uses).
function occurrencesInRange(q: { start: DayKey; end: DayKey }) {
  const byMonthDay = new Map<string, DayKey>();
  for (const day of eachDay(q.start, q.end)) {
    const [y, m, d] = day.split("-").map(Number);
    byMonthDay.set(`${m}-${d}`, day);
    if (m === 2 && d === 28 && !isLeapYear(y)) byMonthDay.set("2-29", day);
  }
  return byMonthDay;
}

const loadRealtorDates: Loader = async (q) => {
  const occurrences = occurrencesInRange(q);
  const pairs = [...occurrences.keys()].map((k) => k.split("-").map(Number) as [number, number]);
  if (pairs.length === 0) return [];
  const select = { id: true, firstName: true, lastName: true, preferredName: true, birthdayMonth: true, birthdayDay: true, careerStartDate: true, relationshipStartDate: true, brokerage: { select: { name: true } } } as const;
  const monthDayMatch = (column: "careerStartDate" | "relationshipStartDate") =>
    Prisma.sql`(${Prisma.join(pairs.map(([m, d]) => Prisma.sql`(EXTRACT(MONTH FROM ${Prisma.raw(`"${column}"`)}) = ${m} AND EXTRACT(DAY FROM ${Prisma.raw(`"${column}"`)}) = ${d})`), " OR ")})`;
  const [birthdays, anniversaryIds] = await Promise.all([
    prisma.realtor.findMany({ where: { archivedAt: null, OR: pairs.map(([m, d]) => ({ birthdayMonth: m, birthdayDay: d })) }, select }),
    prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "realtors" WHERE "archivedAt" IS NULL AND (
        ("careerStartDate" IS NOT NULL AND ${monthDayMatch("careerStartDate")}) OR
        ("relationshipStartDate" IS NOT NULL AND ${monthDayMatch("relationshipStartDate")})
      )
    `),
  ]);
  const anniversaries = anniversaryIds.length ? await prisma.realtor.findMany({ where: { id: { in: anniversaryIds.map((r) => r.id) } }, select }) : [];

  const events: CalendarEvent[] = [];
  for (const r of birthdays) {
    const day = occurrences.get(`${r.birthdayMonth}-${r.birthdayDay}`);
    if (!day) continue;
    const name = realtorDisplayName(r);
    events.push(base({ id: `birthday:${r.id}:${day}`, type: "birthday", layer: "realtors", sourceType: "Realtor", sourceId: r.id, title: `Birthday · ${name}`, subtitle: r.brokerage?.name ?? null, allDay: true, day, href: `/realtors/${r.id}` }));
  }
  for (const r of anniversaries) {
    const name = realtorDisplayName(r);
    for (const [column, type, noun] of [
      ["careerStartDate", "careerAnniversary", "in real estate"],
      ["relationshipStartDate", "relationshipAnniversary", "working together"],
    ] as const) {
      const startKey = dateOnlyKey(r[column]);
      if (!startKey) continue;
      const [sy, sm, sd] = startKey.split("-").map(Number);
      const day = occurrences.get(`${sm}-${sd}`);
      if (!day) continue;
      const years = Number(day.slice(0, 4)) - sy;
      if (years < 1) continue; // the start date itself isn't an anniversary
      events.push(
        base({ id: `${type}:${r.id}:${day}`, type, layer: "realtors", sourceType: "Realtor", sourceId: r.id, title: `${years} year${years === 1 ? "" : "s"} ${noun} · ${name}`, subtitle: r.brokerage?.name ?? null, allDay: true, day, href: `/realtors/${r.id}` })
      );
    }
  }
  return events;
};

// ---------------------------------------------------------------------------
// Billing — collectible invoices by due date. Off by default; financial roles only.
// ---------------------------------------------------------------------------

const loadBilling: Loader = async (q, ctx) => {
  if (!can(q.role, "financial:read")) return [];
  const rows = await prisma.invoice.findMany({
    where: {
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      dueAt: { gte: startOfDayUtc(addDays(q.start, -1), ctx.config.timeZone), lt: startOfDayUtc(addDays(q.end, 1), ctx.config.timeZone) },
    },
    include: {
      items: { select: { amount: true } },
      payments: { select: { amount: true } },
      transaction: { select: { id: true, property: { select: { addressLine1: true, city: true } } } },
    },
  });
  const today = toDayKey(ctx.now, ctx.config.timeZone);
  return rows
    .map((inv) => ({ inv, day: toDayKey(inv.dueAt!, ctx.config.timeZone), balance: invoiceTotals(inv).balance }))
    .filter(({ inv, day, balance }) => inRange(day, q) && isInvoiceCollectible(inv.status, balance))
    .map(({ inv, day, balance }) =>
      base({
        id: `invoice:${inv.id}`,
        type: "invoiceDue",
        layer: "billing",
        sourceType: "Invoice",
        sourceId: inv.id,
        title: `Invoice ${inv.invoiceNumber} due`,
        subtitle: `${formatMoney(balance)} · ${address(inv.transaction.property) ?? "No property"}`,
        allDay: true,
        day,
        status: inv.status,
        priority: day <= today ? "high" : "normal",
        href: `/transactions/${inv.transaction.id}`,
      })
    );
};

const LOADERS: Record<CalendarLayer, Loader> = {
  inspections: loadInspections,
  appointments: loadAppointments,
  tasks: loadTasks("tasks"),
  reports: loadReportDeadlines,
  transactions: loadTransactionDates,
  realtors: async (q, ctx) => [...(await loadTasks("realtors")(q, ctx)), ...(await loadRealtorDates(q, ctx))],
  billing: loadBilling,
};

// Maximum span one request may ask for: the 4-month planning view (at most
// 123 days). Every other view asks for far less.
export const MAX_RANGE_DAYS = 124;

export async function loadCalendarEvents(q: CalendarQuery): Promise<CalendarEvent[]> {
  const config = getCalendarConfig();
  const ctx: Ctx = { config, rangeStart: startOfDayUtc(q.start, config.timeZone), rangeEnd: startOfDayUtc(q.end, config.timeZone), now: q.now ?? new Date() };
  const results = await Promise.all(q.layers.map((layer) => LOADERS[layer]({ ...q, role: q.role }, ctx)));
  return results.flat().sort((a, b) => (a.day === b.day ? (a.start ?? "").localeCompare(b.start ?? "") : a.day.localeCompare(b.day)));
}
