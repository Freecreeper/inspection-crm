import type { PreferredContactMethod, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { getRealtorMetrics, type RealtorMetrics } from "./metrics";
import { loadRealtorTimeline } from "./timeline";
import { realtorDisplayName, realtorLegalNameIfDifferent } from "./display";
import { normalizePreviewSections, type PreviewSection } from "./previewLayout";

export interface RealtorPreview {
  id: string;
  displayName: string;
  legalName: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  preferredContactMethod: PreferredContactMethod | null;
  notes: string | null;
  brokerage: { id: string; name: string; city: string | null } | null;
  // null when every metric section is switched off (nothing was queried).
  metrics: RealtorMetrics | null;
  nextAction: { id: string; title: string; dueAt: string | null } | null;
  recentActivity: { id: string; kind: string; at: string; title: string; detail?: string; href?: string }[];
  sections: PreviewSection[];
  permissions: { canWrite: boolean; canViewFinancials: boolean };
}

// Everything the drawer shows, loaded only once a realtor is selected, and
// only for the sections this user has switched on. Revenue is never queried
// for a role without financial:read, so it can't leak through the client.
export async function loadRealtorPreview(
  realtorId: string,
  role: Role | undefined,
  userId: string | null
): Promise<RealtorPreview | null> {
  const [realtor, user] = await Promise.all([
    prisma.realtor.findFirst({
      where: { id: realtorId, archivedAt: null },
      include: { brokerage: { select: { id: true, name: true, city: true } } },
    }),
    userId ? prisma.user.findUnique({ where: { id: userId }, select: { realtorPreviewSections: true } }) : null,
  ]);
  if (!realtor) return null;

  const sections = normalizePreviewSections(user?.realtorPreviewSections);
  const on = (s: PreviewSection) => sections.includes(s);
  const canViewFinancials = can(role, "financial:read");
  const wantsMetrics = on("transactions") || on("referrals") || on("revenue");

  const [metrics, nextTask, recentActivity] = await Promise.all([
    wantsMetrics ? getRealtorMetrics(realtorId, { includeFinancials: canViewFinancials && on("revenue") }) : null,
    on("nextAction") ? findNextAction(realtorId) : null,
    on("activity") ? loadRealtorTimeline(realtorId, { limit: 5, includeDocuments: false }) : [],
  ]);

  return {
    id: realtor.id,
    displayName: realtorDisplayName(realtor),
    legalName: realtorLegalNameIfDifferent(realtor),
    firstName: realtor.firstName,
    lastName: realtor.lastName,
    preferredName: realtor.preferredName,
    email: realtor.email,
    phone: realtor.phone,
    preferredContactMethod: realtor.preferredContactMethod,
    notes: realtor.notes,
    brokerage: realtor.brokerage,
    metrics,
    nextAction: nextTask ? { id: nextTask.id, title: nextTask.title, dueAt: nextTask.dueAt?.toISOString() ?? null } : null,
    recentActivity: recentActivity.map((item) => ({ ...item, at: item.at.toISOString() })),
    sections,
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
