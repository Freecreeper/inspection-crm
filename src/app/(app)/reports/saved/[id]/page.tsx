import { canSeeSavedReport, requireReportAccess } from "@/lib/reports/access";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { configToSearchParams, type ReportConfig } from "@/lib/reporting";

// Reopening a saved report is just replaying its stored config through the
// builder's own query-string format — one code path renders both a fresh
// query and a reopened saved one.
export default async function SavedReportRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireReportAccess();
  const { id } = await params;
  const report = await prisma.reportDefinition.findUnique({ where: { id } });
  // Someone else's private report looks the same as one that doesn't exist.
  if (!report || !canSeeSavedReport(report, userId)) notFound();

  const config = report.config as unknown as ReportConfig;
  const query = configToSearchParams(config).toString();
  redirect(`/reports/builder?${query}`);
}
