"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { validateMediaUpload, safeFileName } from "@/lib/media";
import { validateFinalizeReport } from "@/lib/validation";
import { generateReportNumber, syncReportSummary, isReportEditable } from "@/lib/reportEngine";
import { getPrimaryCustomer } from "@/lib/transactions";
import { renderReportPdf } from "@/lib/pdf/renderReportPdf";
import { withEditableReport, type EditableReport } from "@/lib/reports/editable";
import type { Role } from "@prisma/client";
import { runAutomationSafely } from "@/lib/email/automations/safe";
import { onReportDeliveryCreated } from "@/lib/email/automations/report";
import { getAutomation } from "@/lib/email/automations/registry";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");
const MEDIA_ROOT = path.join(process.cwd(), "storage", "media");

// Section-editor saves must show up without a manual reload (otherwise an
// inspector re-enters a finding they think didn't save).
function refreshReport(report: EditableReport | undefined | null) {
  if (report) revalidatePath(`/inspections/${report.inspectionId}/report`, "layout");
}

// A double tap on "Add finding" arrives as two identical requests a moment
// apart; the second is ignored rather than saved twice.
const DUPLICATE_FINDING_WINDOW_MS = 15_000;

// Copies the template's structure into the report's own Section/Component
// rows (never a live reference to the template — editing this report's
// sections can never mutate the shared template, the same "copy, don't
// link" rule Narrative already follows). Requires an active template; every
// other report field can be filled in afterward.
export async function createReportFromTemplate(inspectionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const templateId = String(formData.get("templateId") ?? "").trim();
  if (!templateId) throw new Error("A template is required.");

  const template = await prisma.reportTemplate.findUniqueOrThrow({
    where: { id: templateId },
    include: {
      sections: {
        where: { active: true },
        orderBy: { displayOrder: "asc" },
        include: { components: { where: { active: true }, orderBy: { displayOrder: "asc" } } },
      },
    },
  });

  // One report per inspection. A second "Start report" (a double click, or
  // a stale tab) opens the existing report instead of hiding it behind a
  // new empty draft. The lock makes concurrent clicks take turns.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inspection-report:${inspectionId}`}))`;
    if (await tx.inspectionReport.findFirst({ where: { inspectionId, status: { not: "ARCHIVED" } }, select: { id: true } })) return;
    await tx.inspectionReport.create({
      data: {
        inspectionId,
        templateId,
        reportNumber: generateReportNumber(),
        status: "DRAFT",
        sections: {
          create: template.sections.map((s) => ({
            name: s.name,
            displayOrder: s.displayOrder,
            components: { create: s.components.map((c) => ({ name: c.name, displayOrder: c.displayOrder })) },
          })),
        },
      },
    });
  });

  revalidatePath(`/inspections/${inspectionId}`);
  redirect(`/inspections/${inspectionId}/report`);
}

export async function updateReportField(reportId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const field = String(formData.get("field") ?? "");
  const allowed = ["title", "introduction", "scope", "limitations", "footer", "internalNotes", "customerFacingNotes"];
  if (!allowed.includes(field)) throw new Error("Unknown field.");
  const value = String(formData.get("value") ?? "").trim() || null;

  const done = await withEditableReport({ reportId }, (tx) => tx.inspectionReport.update({ where: { id: reportId }, data: { [field]: value } }));
  refreshReport(done?.report);
  revalidatePath(`/inspections`);
}

export async function setSectionNotApplicable(sectionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const notApplicable = String(formData.get("notApplicable") ?? "") === "true";
  const defaultNarrative = String(formData.get("defaultNarrative") ?? "").trim() || null;

  const done = await withEditableReport({ sectionId }, (tx) => tx.reportSection.update({ where: { id: sectionId }, data: { notApplicable, defaultNarrative } }));
  refreshReport(done?.report);
}

// A component that can't be inspected is not a failure to document — it's
// its own valid finding-free outcome as long as the reason is recorded
// (§ "Inspection Status For Components"). Nothing here requires
// limitationNote; finalizeReport only warns/blocks based on it being empty.
export async function setComponentStatus(componentId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const inspectionStatus = String(formData.get("inspectionStatus") ?? "").trim();
  const limitationNote = String(formData.get("limitationNote") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const materialType = String(formData.get("materialType") ?? "").trim() || null;
  if (!inspectionStatus) throw new Error("A status is required.");

  const done = await withEditableReport({ componentId }, (tx) =>
    tx.reportComponent.update({ where: { id: componentId }, data: { inspectionStatus: inspectionStatus as never, limitationNote, notes, materialType } })
  );
  refreshReport(done?.report);
}

export async function createFinding(componentId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!title || !description) throw new Error("A finding needs a title and a description.");

  const categoryId = String(formData.get("categoryId") ?? "").trim() || null;
  const location = String(formData.get("location") ?? "").trim() || null;
  const recommendation = String(formData.get("recommendation") ?? "").trim() || null;
  const recommendedProfessional = String(formData.get("recommendedProfessional") ?? "").trim() || null;
  const inspectorNotes = String(formData.get("inspectorNotes") ?? "").trim() || null;

  const done = await withEditableReport({ componentId }, async (tx) => {
    const since = new Date(Date.now() - DUPLICATE_FINDING_WINDOW_MS);
    if (await tx.finding.findFirst({ where: { componentId, title, description, createdAt: { gte: since } }, select: { id: true } })) return;
    await tx.finding.create({
      data: {
        componentId,
        title,
        description,
        categoryId,
        location,
        recommendation,
        recommendedProfessional,
        inspectorNotes,
        safetyRelated: formData.get("safetyRelated") === "true",
        repairRecommended: formData.get("repairRecommended") === "true",
        monitor: formData.get("monitor") === "true",
        furtherEvaluation: formData.get("furtherEvaluation") === "true",
        includedInSummary: formData.get("includedInSummary") === "true",
        createdById: session?.user?.id ?? null,
      },
    });
  });
  refreshReport(done?.report);
}

// Copies a library Narrative straight into a new Finding — the inspector can
// edit the copy afterward with updateFinding without ever touching the
// shared library entry (§ "Narrative Library" / Fig. 3).
export async function createFindingFromNarrative(componentId: string, narrativeId: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const narrative = await prisma.narrative.findUniqueOrThrow({ where: { id: narrativeId } });

  const done = await withEditableReport({ componentId }, async (tx) => {
    const since = new Date(Date.now() - DUPLICATE_FINDING_WINDOW_MS);
    const repeat = await tx.finding.findFirst({ where: { componentId, title: narrative.title, description: narrative.narrativeText, createdAt: { gte: since } }, select: { id: true } });
    if (repeat) return;
    await tx.finding.create({
      data: {
        componentId,
        title: narrative.title,
        description: narrative.narrativeText,
        recommendation: narrative.recommendationText,
        createdById: session?.user?.id ?? null,
      },
    });
  });
  refreshReport(done?.report);
}

export async function updateFinding(findingId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!title || !description) throw new Error("A finding needs a title and a description.");

  const done = await withEditableReport({ findingId }, (tx) =>
    tx.finding.update({
      where: { id: findingId },
      data: {
        title,
        description,
        categoryId: String(formData.get("categoryId") ?? "").trim() || null,
        location: String(formData.get("location") ?? "").trim() || null,
        recommendation: String(formData.get("recommendation") ?? "").trim() || null,
        recommendedProfessional: String(formData.get("recommendedProfessional") ?? "").trim() || null,
        inspectorNotes: String(formData.get("inspectorNotes") ?? "").trim() || null,
        safetyRelated: formData.get("safetyRelated") === "true",
        repairRecommended: formData.get("repairRecommended") === "true",
        monitor: formData.get("monitor") === "true",
        furtherEvaluation: formData.get("furtherEvaluation") === "true",
        includedInSummary: formData.get("includedInSummary") === "true",
      },
    })
  );
  refreshReport(done?.report);
}

// Removing a finding also removes its summary entry (which otherwise blocks
// the delete) and its photos. A repeat (second tap) finds nothing and is a
// no-op instead of an error page.
export async function deleteFinding(findingId: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");
  const done = await withEditableReport({ findingId }, async (tx) => {
    const media = await tx.media.findMany({ where: { findingId }, select: { storageKey: true } });
    await tx.reportSummaryItem.deleteMany({ where: { findingId } });
    await tx.media.deleteMany({ where: { findingId } });
    await tx.finding.deleteMany({ where: { id: findingId } });
    return media;
  });
  for (const m of done?.result ?? []) await unlink(path.join(MEDIA_ROOT, m.storageKey)).catch(() => undefined);
  refreshReport(done?.report);
}

export async function uploadMedia(inspectionId: string, findingId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("A photo is required.");

  const validation = validateMediaUpload(file);
  if (!validation.ok) throw new Error(validation.error);

  // The ids arrive from the browser, so the inspection is taken from the
  // finding's own record (never from the request) and must match, and the
  // report must still be open for editing — all before touching the disk.
  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
    select: { component: { select: { section: { select: { report: { select: { inspectionId: true, status: true } } } } } } },
  });
  const report = finding?.component.section.report;
  if (!report || report.inspectionId !== inspectionId) throw new Error("That finding isn't part of this inspection.");
  if (!isReportEditable(report.status)) throw new Error("This report is not open for editing.");

  const caption = String(formData.get("caption") ?? "").trim() || null;
  const buffer = Buffer.from(await file.arrayBuffer());
  const storageKey = `${report.inspectionId}/${randomUUID()}-${safeFileName(file.name)}`;
  const destination = path.resolve(MEDIA_ROOT, storageKey);
  // Same containment check the read routes use.
  if (!destination.startsWith(MEDIA_ROOT + path.sep)) throw new Error("Invalid upload location.");

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, buffer);

  try {
    await prisma.media.create({
      data: {
        inspectionId: report.inspectionId,
        findingId,
        storageKey,
        fileType: file.type,
        originalFileName: file.name,
        caption,
        uploadedById: session?.user?.id ?? null,
      },
    });
  } catch (err) {
    // No untracked files left behind.
    await unlink(destination).catch(() => undefined);
    throw err;
  }
  revalidatePath(`/inspections/${report.inspectionId}/report`, "layout");
}

export async function deleteMedia(mediaId: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const done = await withEditableReport({ mediaId }, async (tx) => {
    const media = await tx.media.findUnique({ where: { id: mediaId }, select: { storageKey: true } });
    await tx.media.deleteMany({ where: { id: mediaId } });
    return media;
  });
  if (done?.result) await unlink(path.join(MEDIA_ROOT, done.result.storageKey)).catch(() => undefined);
  refreshReport(done?.report);
}

export async function toggleMediaIncludeInReport(mediaId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");
  const includeInReport = String(formData.get("includeInReport") ?? "") === "true";
  const done = await withEditableReport({ mediaId }, (tx) => tx.media.update({ where: { id: mediaId }, data: { includeInReport } }));
  refreshReport(done?.report);
}

// Finalization is a deliberate human action, gated on report:finalize — never
// automatic, never silent (§ "Report Finalization"). Only genuinely critical
// gaps (a component left undocumented with no explanation) actually block;
// everything else in validateFinalizeReport is a warning the inspector can
// consciously accept, matching the non-blocking philosophy applied
// everywhere else in this app.
export async function finalizeReport(reportId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "report:finalize");

  const reasonForRevision = String(formData.get("reasonForRevision") ?? "").trim() || null;

  const report = await prisma.inspectionReport.findUniqueOrThrow({
    where: { id: reportId },
    include: {
      inspection: {
        include: {
          property: true,
          inspector: true,
          transaction: {
            include: {
              customers: { include: { customer: true } },
              realtors: { include: { realtor: true } },
            },
          },
        },
      },
      sections: { orderBy: { displayOrder: "asc" }, include: { components: { orderBy: { displayOrder: "asc" }, include: { findings: { include: { category: true } } } } } },
      versions: true,
    },
  });

  if (!isReportEditable(report.status)) throw new Error("This report is not open for editing.");

  await prisma.$transaction((tx) => syncReportSummary(tx, reportId));

  const media = await prisma.media.findMany({
    where: { OR: [{ reportId }, { finding: { component: { section: { reportId } } } }] },
  });

  const allComponents = report.sections.flatMap((s) => s.components);
  const allFindings = allComponents.flatMap((c) => c.findings);
  const primaryCustomer = getPrimaryCustomer(report.inspection.transaction.customers);

  const readiness = validateFinalizeReport({
    sectionsTotal: report.sections.length,
    sectionsCompleted: report.sections.filter(
      (s) => s.notApplicable || s.components.every((c) => c.inspectionStatus !== "NOT_INSPECTED")
    ).length,
    componentsNotInspectedWithoutReason: allComponents.filter(
      (c) => ["NOT_INSPECTED", "NOT_ACCESSIBLE", "LIMITED_INSPECTION"].includes(c.inspectionStatus) && !c.limitationNote
    ).length,
    findingsMissingRecommendation: allFindings.filter((f) => !f.recommendation).length,
    photosMissingCaptions: media.filter((m) => !m.caption).length,
    customerEmail: primaryCustomer?.email,
    realtorAssigned: report.inspection.transaction.realtors.length > 0,
    squareFootageKnown: Boolean(report.inspection.property.squareFootage),
  });

  if (!readiness.ok) {
    const blockers = readiness.issues.filter((i) => i.severity === "blocker").map((i) => i.message);
    throw new Error(`Cannot finalize: ${blockers.join("; ")}`);
  }

  const versionNumber = report.versions.length + 1;
  const summaryItems = await prisma.reportSummaryItem.findMany({ where: { reportId }, orderBy: { displayOrder: "asc" } });

  const snapshot = {
    reportNumber: report.reportNumber,
    title: report.title,
    introduction: report.introduction,
    scope: report.scope,
    limitations: report.limitations,
    footer: report.footer,
    customerFacingNotes: report.customerFacingNotes,
    property: report.inspection.property,
    inspectorName: report.inspection.inspector?.name ?? null,
    customerName: primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : null,
    inspectionDate: report.inspection.completedAt ?? report.inspection.scheduledAt,
    finalizedAt: new Date().toISOString(),
    versionNumber,
    reasonForRevision,
    sections: report.sections.map((s) => ({
      name: s.name,
      notApplicable: s.notApplicable,
      components: s.components.map((c) => ({
        name: c.name,
        inspectionStatus: c.inspectionStatus,
        limitationNote: c.limitationNote,
        notes: c.notes,
        findings: c.findings.map((f) => ({
          id: f.id,
          title: f.title,
          description: f.description,
          location: f.location,
          category: f.category?.label ?? null,
          recommendation: f.recommendation,
          safetyRelated: f.safetyRelated,
          repairRecommended: f.repairRecommended,
          monitor: f.monitor,
          furtherEvaluation: f.furtherEvaluation,
        })),
      })),
    })),
    summary: summaryItems.map((item) => ({ groupLabel: item.groupLabel, findingId: item.findingId })),
  };

  const pdfBuffer = await renderReportPdf(snapshot, media);
  const pdfStorageKey = `${reportId}/v${versionNumber}-${randomUUID()}.pdf`;
  const pdfDestination = path.join(UPLOAD_ROOT, "report-pdfs", pdfStorageKey);
  await mkdir(path.dirname(pdfDestination), { recursive: true });
  await writeFile(pdfDestination, pdfBuffer);

  await prisma.$transaction([
    prisma.reportVersion.create({
      data: {
        reportId,
        versionNumber,
        snapshot,
        pdfStorageKey: path.join("report-pdfs", pdfStorageKey),
        reasonForRevision,
        createdById: session?.user?.id ?? null,
      },
    }),
    prisma.inspectionReport.update({
      where: { id: reportId },
      data: { status: "FINALIZED", finalizedAt: new Date(), finalizedById: session?.user?.id ?? null },
    }),
  ]);

  revalidatePath(`/inspections/${report.inspectionId}/report`);
  redirect(`/inspections/${report.inspectionId}/report/versions`);
}

// Reopens a finalized report for editing. The prior ReportVersion is never
// touched — the next finalize call creates versionNumber + 1 alongside it
// (§ "Report Amendment" / "Report Versioning").
export async function amendReport(reportId: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "report:amend");

  const report = await prisma.inspectionReport.findUniqueOrThrow({ where: { id: reportId } });
  if (report.status !== "FINALIZED" && report.status !== "DELIVERED") {
    throw new Error("Only a finalized or delivered report can be amended.");
  }

  await prisma.inspectionReport.update({ where: { id: reportId }, data: { status: "AMENDED" } });
  revalidatePath(`/inspections/${report.inspectionId}/report`);
}

// Recipients are always explicit — never inferred from who happens to be a
// participant on the transaction (§ "Report Delivery"). Email sending itself
// isn't wired to a real provider (no POSTMARK_API_TOKEN configured); this
// records the delivery and issues a token-scoped link for staff to share
// manually, and says so in the UI rather than claiming an email went out.
// Withdraws a delivered link (sent to the wrong person, or superseded). The
// link stops working at once; a queued email for it is cancelled by its
// send-time guard.
export async function revokeDelivery(deliveryId: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "report:deliver");
  const delivery = await prisma.reportDelivery.findUnique({ where: { id: deliveryId }, select: { report: { select: { inspectionId: true } } } });
  if (!delivery) return;
  const { count } = await prisma.reportDelivery.updateMany({ where: { id: deliveryId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (count) await logActivity(prisma, { actorId: session?.user?.id, action: "report.delivery_revoked", entityType: "ReportDelivery", entityId: deliveryId });
  revalidatePath(`/inspections/${delivery.report.inspectionId}/report/versions`);
}

// How long a repeat of the same delivery (same report version, recipient,
// and method) counts as the same click rather than a new delivery.
const DELIVERY_REPEAT_WINDOW_MS = 10 * 60_000;
const DELIVERY_LINK_DAYS = 30;

export async function createDelivery(reportId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "report:deliver");

  const recipientType = String(formData.get("recipientType") ?? "").trim();
  const recipientName = String(formData.get("recipientName") ?? "").trim();
  const recipientEmail = String(formData.get("recipientEmail") ?? "").trim();
  if (!recipientType || !recipientName || !recipientEmail) {
    throw new Error("Recipient type, name, and email are required.");
  }

  const report = await prisma.inspectionReport.findUnique({ where: { id: reportId }, select: { status: true, inspectionId: true } });
  if (!report) throw new Error("Report not found.");
  // Sending while an amendment is open would mail the old version and
  // silently close the amendment.
  if (report.status === "AMENDED") throw new Error("This report is being amended. Finalize the new version before delivering it.");

  const latestVersion = await prisma.reportVersion.findFirst({
    where: { reportId },
    orderBy: { versionNumber: "desc" },
  });
  if (!latestVersion) throw new Error("Finalize the report before delivering it.");

  const sendEmail = String(formData.get("sendEmail") ?? "") === "1";
  if (sendEmail && !(await getAutomation("report_ready")).active) {
    throw new Error("Report emails are turned off in Email settings — create a link instead.");
  }

  // "Send by email": the delivery is created PENDING with an unusable
  // placeholder token hash; the email worker mints the real link at the
  // moment it sends, so the raw token never exists anywhere at rest. The
  // delivery (and report) only become SENT/DELIVERED once the email goes out.
  // "Create link": the raw token is generated here and shown once.
  const rawToken = sendEmail ? null : randomUUID() + randomUUID();
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + DELIVERY_LINK_DAYS * 86_400_000);

  // A double click on Deliver must not create two deliveries (two emails
  // with two different links). Deliveries for one report are made one at a
  // time under a lock, and the repeat check and the insert share it, so a
  // matching delivery from the last few minutes is reused instead.
  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report-delivery:${reportId}`}))`;
    const repeat = await tx.reportDelivery.findFirst({
      where: {
        reportId,
        versionId: latestVersion.id,
        recipientEmail: { equals: recipientEmail, mode: "insensitive" },
        deliveryMethod: sendEmail ? "email" : "link",
        status: { not: "FAILED" },
        // Links expire DELIVERY_LINK_DAYS after creation, so this means "created recently".
        accessExpiresAt: { gte: new Date(accessExpiresAt.getTime() - DELIVERY_REPEAT_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (repeat) return null;
    const delivery = await tx.reportDelivery.create({
      data: {
        reportId,
        versionId: latestVersion.id,
        recipientType: recipientType as never,
        recipientName,
        recipientEmail,
        deliveryMethod: sendEmail ? "email" : "link",
        status: sendEmail ? "PENDING" : "SENT",
        deliveredAt: sendEmail ? null : now,
        deliveredById: session?.user?.id ?? null,
        accessTokenHash: createHash("sha256").update(rawToken ?? `unissued:${randomUUID()}`).digest("hex"),
        accessExpiresAt,
      },
      select: { id: true },
    });
    // Only a finalized report becomes "delivered" (never an amendment).
    if (!sendEmail) await tx.inspectionReport.updateMany({ where: { id: reportId, status: { in: ["FINALIZED", "DELIVERED"] } }, data: { status: "DELIVERED", deliveredAt: now } });
    return delivery;
  });
  if (!created) redirect(`/inspections/${report.inspectionId}/report/versions`);

  if (sendEmail) {
    await runAutomationSafely({ key: "report_ready", entityType: "ReportDelivery", entityId: created.id, actorId: session?.user?.id }, () =>
      onReportDeliveryCreated(created.id, { actorId: session?.user?.id })
    );
    revalidatePath(`/inspections`);
    redirect(`/inspections/${report.inspectionId}/report/versions`);
  }

  // The raw token can only ever be shown once — only its hash is stored.
  // Passed to the next page via a short-lived cookie rather than a URL query
  // string, which would otherwise land in browser history, server access
  // logs, and any Referer header.
  const cookieStore = await cookies();
  cookieStore.set("delivery_token_flash", rawToken!, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 120,
    path: "/",
  });

  revalidatePath(`/inspections`);
  redirect(`/inspections/${report.inspectionId}/report/versions`);
}
