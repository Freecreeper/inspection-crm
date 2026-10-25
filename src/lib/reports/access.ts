import type { Role } from "@prisma/client";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";

// Every Reports page calls this next to its data (a layout check alone
// doesn't stop the page segment from rendering). Roles without
// report-builder:use get a 404, the same as a report that doesn't exist.
export async function requireReportAccess(): Promise<{ userId: string; role: Role }> {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  if (!session?.user?.id || !can(role, "report-builder:use")) notFound();
  return { userId: session.user.id, role: role! };
}

// A saved report is visible to its owner, or to everyone with report
// access once it's shared.
export function canSeeSavedReport(report: { ownerId: string; shared: boolean }, userId: string): boolean {
  return report.ownerId === userId || report.shared;
}
