import type { PreferredContactMethod, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { getRealtorMetrics, type RealtorMetrics } from "./metrics";
import { loadRealtorTimeline } from "./timeline";
import { realtorDisplayName, realtorLegalNameIfDifferent } from "./display";

export interface RealtorPreview {
  id: string;
  displayName: string;
  legalName: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  active: boolean;
  email: string | null;
  phone: string | null;
  preferredContactMethod: PreferredContactMethod | null;
  notes: string | null;
  brokerage: { id: string; name: string; city: string | null } | null;
  metrics: RealtorMetrics;
  nextAction: { id: string; title: string; dueAt: string | null } | null;
  recentActivity: { id: string; kind: string; at: string; title: string; detail?: string; href?: string }[];
  permissions: { canWrite: boolean; canViewFinancials: boolean };
}

// Everything the drawer shows, loaded only once a realtor is selected. The
// payload is shaped by the viewer's role here on the server: revenue is
// never queried for a role without financial:read, so it can't leak
// through the client.
export async function loadRealtorPreview(realtorId: string, role: Role | undefined): Promise<RealtorPreview | null> {
  const canViewFinancials = can(role, "financial:read");
  const realtor = await prisma.realtor.findFirst({
    where: { id: realtorId, archivedAt: null },
    include: { brokerage: { select: { id: true, name: true, city: true } } },
  });
  if (!realtor) return null;

  const [metrics, nextTask, recentActivity] = await Promise.all([
    getRealtorMetrics(realtorId, { includeFinancials: canViewFinancials }),
    findNextAction(realtorId),
    loadRealtorTimeline(realtorId, { limit: 5, includeDocuments: false }),
  ]);

  return {
    id: realtor.id,
    displayName: realtorDisplayName(realtor),
    legalName: realtorLegalNameIfDifferent(realtor),
    firstName: realtor.firstName,
    lastName: realtor.lastName,
    preferredName: realtor.preferredName,
    active: realtor.active,
    email: realtor.email,
    phone: realtor.phone,
    preferredContactMethod: realtor.preferredContactMethod,
    notes: realtor.notes,
    brokerage: realtor.brokerage,
    metrics,
    nextAction: nextTask ? { id: nextTask.id, title: nextTask.title, dueAt: nextTask.dueAt?.toISOString() ?? null } : null,
    recentActivity: recentActivity.map((item) => ({ ...item, at: item.at.toISOString() })),
    permissions: { canWrite: can(role, "crm:write"), canViewFinancials },
  };
}

// The next incomplete follow-up: soonest due first, undated ones after.
export function findNextAction(realtorId: string) {
  return prisma.task.findFirst({
    where: { realtorId, completedAt: null },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
}
