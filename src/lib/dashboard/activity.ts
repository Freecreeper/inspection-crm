import { prisma } from "@/lib/prisma";
import { can, type Permission } from "@/lib/rbac";
import { formatMoney } from "@/lib/invoices";
import { realtorDisplayName } from "@/lib/realtors/display";
import type { DashboardContext } from "./sources";
import type { ActivityEntry } from "./types";

// Recent Activity reads what the CRM already records — the ActivityLog
// audit trail, report versions and deliveries, and sent automation email —
// and merges them by time. It is a view, not a second history: nothing is
// written here.

export const ACTIVITY_LOOKBACK_DAYS = 7;
export const ACTIVITY_LIMIT = 25;

// Audit actions worth showing on the Dashboard, and who may see each.
export const ACTIVITY_ACTIONS: Record<string, { label: string; permission?: Permission }> = {
  "inspection.scheduled": { label: "Inspection scheduled" },
  "inspection.rescheduled": { label: "Inspection rescheduled" },
  "inspection.cancelled": { label: "Inspection cancelled" },
  "inspection.agreement_signed": { label: "Agreement signed" },
  "task.completed": { label: "Task completed" },
  "invoice.payment_recorded": { label: "Payment received", permission: "financial:read" },
  "customer.created": { label: "Customer added" },
  "realtor.created": { label: "Realtor added" },
  "transaction.created": { label: "Transaction started" },
};

const address = (p: { addressLine1: string; city: string } | null | undefined) => (p ? `${p.addressLine1}, ${p.city}` : null);

function idsOf(rows: { entityType: string; entityId: string }[], type: string) {
  return [...new Set(rows.filter((r) => r.entityType === type).map((r) => r.entityId))];
}

export async function loadRecentActivity(ctx: DashboardContext): Promise<ActivityEntry[]> {
  const role = ctx.viewer.role;
  const since = new Date(ctx.now.getTime() - ACTIVITY_LOOKBACK_DAYS * 86_400_000);
  const actions = Object.entries(ACTIVITY_ACTIONS)
    .filter(([, a]) => !a.permission || can(role, a.permission))
    .map(([k]) => k);

  const [logs, versions, deliveries, emails] = await Promise.all([
    prisma.activityLog.findMany({
      where: { action: { in: actions }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_LIMIT,
      select: { id: true, action: true, entityType: true, entityId: true, after: true, createdAt: true, actor: { select: { name: true } } },
    }),
    prisma.reportVersion.findMany({
      where: { finalizedAt: { gte: since } },
      orderBy: { finalizedAt: "desc" },
      take: ACTIVITY_LIMIT,
      select: { id: true, versionNumber: true, finalizedAt: true, report: { select: { inspectionId: true, inspection: { select: { property: { select: { addressLine1: true, city: true } } } } } } },
    }),
    prisma.reportDelivery.findMany({
      where: { status: { in: ["SENT", "VIEWED"] }, deliveredAt: { gte: since } },
      orderBy: { deliveredAt: "desc" },
      take: ACTIVITY_LIMIT,
      select: { id: true, recipientName: true, deliveredAt: true, report: { select: { inspectionId: true, inspection: { select: { property: { select: { addressLine1: true, city: true } } } } } } },
    }),
    can(role, "email:view")
      ? prisma.emailMessage.findMany({
          where: { status: { in: ["SENT", "DELIVERED"] }, automationId: { not: null }, reportDeliveryId: null, sentAt: { gte: since } },
          orderBy: { sentAt: "desc" },
          take: ACTIVITY_LIMIT,
          select: { id: true, status: true, recipientName: true, sentAt: true, deliveredAt: true, simulated: true, automation: { select: { name: true } } },
        })
      : [],
  ]);

  // Describe audit rows with one batched lookup per entity type (no N+1).
  const [inspections, tasks, invoices, customers, realtors, transactions] = await Promise.all([
    idsOf(logs, "Inspection").length ? prisma.inspection.findMany({ where: { id: { in: idsOf(logs, "Inspection") } }, select: { id: true, property: { select: { addressLine1: true, city: true } } } }) : [],
    idsOf(logs, "Task").length ? prisma.task.findMany({ where: { id: { in: idsOf(logs, "Task") } }, select: { id: true, title: true, realtor: { select: { id: true, firstName: true, lastName: true, preferredName: true } } } }) : [],
    idsOf(logs, "Invoice").length ? prisma.invoice.findMany({ where: { id: { in: idsOf(logs, "Invoice") } }, select: { id: true, invoiceNumber: true, transactionId: true } }) : [],
    idsOf(logs, "Customer").length ? prisma.customer.findMany({ where: { id: { in: idsOf(logs, "Customer") } }, select: { id: true, firstName: true, lastName: true } }) : [],
    idsOf(logs, "Realtor").length ? prisma.realtor.findMany({ where: { id: { in: idsOf(logs, "Realtor") } }, select: { id: true, firstName: true, lastName: true, preferredName: true } }) : [],
    idsOf(logs, "Transaction").length ? prisma.transaction.findMany({ where: { id: { in: idsOf(logs, "Transaction") } }, select: { id: true, property: { select: { addressLine1: true, city: true } } } }) : [],
  ]);
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  const insp = byId(inspections);
  const task = byId(tasks);
  const inv = byId(invoices);
  const cust = byId(customers);
  const realtor = byId(realtors);
  const tx = byId(transactions);

  const entries: ActivityEntry[] = [];
  for (const log of logs) {
    let label = ACTIVITY_ACTIONS[log.action]?.label ?? log.action;
    let detail: string | null = null;
    let href: string | null = null;
    switch (log.entityType) {
      case "Inspection": {
        detail = address(insp.get(log.entityId)?.property);
        href = `/inspections/${log.entityId}`;
        break;
      }
      case "Task": {
        const t = task.get(log.entityId);
        if (t?.realtor) {
          label = "Realtor follow-up completed";
          detail = `${realtorDisplayName(t.realtor)} · ${t.title}`;
          href = `/realtors/${t.realtor.id}`;
        } else {
          detail = t?.title ?? null;
          href = "/tasks";
        }
        break;
      }
      case "Invoice": {
        const i = inv.get(log.entityId);
        const after = (log.after ?? {}) as { amount?: string };
        detail = [after.amount ? formatMoney(after.amount) : null, i ? `Invoice ${i.invoiceNumber}` : null].filter(Boolean).join(" · ") || null;
        href = i ? `/transactions/${i.transactionId}` : null;
        break;
      }
      case "Customer": {
        const c = cust.get(log.entityId);
        detail = c ? `${c.firstName} ${c.lastName}` : null;
        href = `/customers/${log.entityId}`;
        break;
      }
      case "Realtor": {
        const r = realtor.get(log.entityId);
        detail = r ? realtorDisplayName(r) : null;
        href = `/realtors/${log.entityId}`;
        break;
      }
      case "Transaction": {
        detail = address(tx.get(log.entityId)?.property);
        href = `/transactions/${log.entityId}`;
        break;
      }
    }
    entries.push({ id: `log:${log.id}`, label, detail, at: log.createdAt.toISOString(), href, actor: log.actor?.name ?? null });
  }
  for (const v of versions) {
    entries.push({
      id: `version:${v.id}`,
      label: v.versionNumber > 1 ? `Report amended (v${v.versionNumber})` : "Report finalized",
      detail: address(v.report.inspection.property),
      at: v.finalizedAt.toISOString(),
      href: `/inspections/${v.report.inspectionId}/report/versions`,
      actor: null,
    });
  }
  for (const d of deliveries) {
    entries.push({
      id: `delivery:${d.id}`,
      label: "Report delivered",
      detail: [address(d.report.inspection.property), `to ${d.recipientName}`].filter(Boolean).join(" · "),
      at: d.deliveredAt!.toISOString(),
      href: `/inspections/${d.report.inspectionId}/report/versions`,
      actor: null,
    });
  }
  for (const m of emails) {
    const delivered = m.status === "DELIVERED";
    entries.push({
      id: `email:${m.id}`,
      label: `${m.automation?.name ?? "Email"} ${delivered ? "delivered" : m.simulated ? "sent (logged only)" : "sent"}`,
      detail: `To ${m.recipientName}`,
      at: (delivered && m.deliveredAt ? m.deliveredAt : m.sentAt!).toISOString(),
      href: `/email/messages/${m.id}`,
      actor: null,
    });
  }

  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, ACTIVITY_LIMIT);
}
