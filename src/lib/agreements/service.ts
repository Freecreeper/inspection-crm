import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { loadEmailVariables } from "@/lib/email/context";
import { getPrimaryCustomer } from "@/lib/transactions";
import { agreementTextHash, DEFAULT_AGREEMENT_BODY, DEFAULT_AGREEMENT_TITLE, fillAgreement } from "./text";
import { agreementUrl, verifyAgreementToken } from "./token";

// Online signing of the pre-inspection agreement. Staff request a
// signature for an inspection; the customer opens the link, reads the
// filled-in text (frozen when the request was made), ticks "I agree" and
// types their name. Signing records when, from where (IP, browser) and a
// fingerprint of exactly what was signed, and marks the inspection's
// agreement signed — the same flag the calendar's readiness checks use.

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const AGREEMENT_LINK_DAYS = 30;
export const MAX_AGREEMENT_LENGTH = 20_000;
export const MAX_TITLE_LENGTH = 120;

// ------------------------------------------------------------------ wording

export async function getAgreementWording(): Promise<{ title: string; body: string; isDefault: boolean; updatedAt: Date | null }> {
  const row = await prisma.agreementSettings.findUnique({ where: { id: "default" } });
  return {
    title: row?.title || DEFAULT_AGREEMENT_TITLE,
    body: row?.body || DEFAULT_AGREEMENT_BODY,
    isDefault: !row?.body,
    updatedAt: row?.updatedAt ?? null,
  };
}

// An empty body goes back to the built-in placeholder wording. Requests
// already sent keep the text they were sent with.
export async function saveAgreementWording(actorId: string | null, input: { title: unknown; body: unknown }): Promise<Result> {
  const title = String(input.title ?? "").trim() || DEFAULT_AGREEMENT_TITLE;
  const body = String(input.body ?? "").trim();
  if (title.length > MAX_TITLE_LENGTH) return { ok: false, error: `Keep the title under ${MAX_TITLE_LENGTH} characters.` };
  if (body.length > MAX_AGREEMENT_LENGTH) return { ok: false, error: `Keep the agreement under ${MAX_AGREEMENT_LENGTH.toLocaleString()} characters.` };
  await prisma.$transaction(async (tx) => {
    await tx.agreementSettings.upsert({ where: { id: "default" }, update: { title, body: body || null, updatedById: actorId }, create: { id: "default", title, body: body || null, updatedById: actorId } });
    await logActivity(tx, { actorId, action: "agreement.wording_updated", entityType: "AgreementSettings", entityId: "default", after: { title, usesDefault: !body, length: body.length } });
  });
  return { ok: true, data: undefined };
}

// ----------------------------------------------------------------- requests

// Makes the signing request for an inspection's customer (the primary one
// unless another is named), replacing any open request so only one link
// works at a time. The text is filled in and frozen now.
export async function requestSignature(actorId: string | null, inspectionId: string, customerId?: string | null): Promise<Result<{ id: string; url: string; missing: string[] }>> {
  const inspection = await prisma.inspection.findUnique({
    where: { id: inspectionId },
    select: { id: true, status: true, transactionId: true, agreementSignedAt: true, transaction: { select: { customers: { include: { customer: true }, orderBy: { createdAt: "asc" } } } } },
  });
  if (!inspection) return { ok: false, error: "That inspection no longer exists." };
  if (inspection.status === "CANCELLED") return { ok: false, error: "This inspection is cancelled." };
  const customers = inspection.transaction.customers;
  const customer = customerId ? customers.find((tc) => tc.customerId === customerId)?.customer : getPrimaryCustomer(customers);
  if (!customer) return { ok: false, error: customerId ? "That customer isn't on this inspection's transaction." : "Add a customer to the transaction first." };

  const wording = await getAgreementWording();
  const vars = await loadEmailVariables({ customerId: customer.id, inspectionId, transactionId: inspection.transactionId });
  const title = fillAgreement(wording.title, vars).text;
  const { text: body, missing } = fillAgreement(wording.body, vars);

  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agreement:${inspectionId}`}))`;
    const replaced = await tx.inspectionAgreement.updateMany({ where: { inspectionId, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
    const row = await tx.inspectionAgreement.create({
      data: {
        inspectionId,
        customerId: customer.id,
        signerName: `${customer.firstName} ${customer.lastName}`,
        signerEmail: customer.email,
        title,
        body,
        textHash: agreementTextHash(title, body),
        expiresAt: new Date(Date.now() + AGREEMENT_LINK_DAYS * 86_400_000),
        createdById: actorId,
      },
      select: { id: true },
    });
    await logActivity(tx, {
      actorId,
      action: "inspection.agreement_requested",
      entityType: "Inspection",
      entityId: inspectionId,
      after: { agreementId: row.id, customerId: customer.id, replacedOpenRequests: replaced.count, usesPlaceholderWording: wording.isDefault },
    });
    return row;
  });
  return { ok: true, data: { id: created.id, url: agreementUrl(created.id), missing } };
}

export async function cancelSignatureRequest(actorId: string | null, agreementId: string): Promise<Result<{ inspectionId: string }>> {
  const row = await prisma.inspectionAgreement.findUnique({ where: { id: agreementId }, select: { inspectionId: true, status: true } });
  if (!row) return { ok: false, error: "That request no longer exists." };
  if (row.status === "SIGNED") return { ok: false, error: "This agreement has already been signed." };
  const { count } = await prisma.inspectionAgreement.updateMany({ where: { id: agreementId, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
  if (count) await logActivity(prisma, { actorId, action: "inspection.agreement_request_cancelled", entityType: "Inspection", entityId: row.inspectionId, after: { agreementId } });
  return { ok: true, data: { inspectionId: row.inspectionId } };
}

// --------------------------------------------------------------- signing

export type SigningView =
  | { state: "invalid" }
  | {
      state: "open" | "signed" | "expired" | "cancelled";
      id: string;
      title: string;
      body: string;
      signerName: string;
      expiresAt: Date;
      signedAt: Date | null;
      signedName: string | null;
      textHash: string;
    };

export async function loadForSigning(token: string, now = new Date()): Promise<SigningView> {
  const id = verifyAgreementToken(token);
  const row = id ? await prisma.inspectionAgreement.findUnique({ where: { id } }) : null;
  if (!row) return { state: "invalid" };
  const state = row.status === "SIGNED" ? "signed" : row.status === "REVOKED" ? "cancelled" : row.expiresAt <= now ? "expired" : "open";
  return { state, id: row.id, title: row.title, body: row.body, signerName: row.signerName, expiresAt: row.expiresAt, signedAt: row.signedAt, signedName: row.signedName, textHash: row.textHash };
}

export async function signAgreement(token: string, input: { name: unknown; agreed: unknown }, client: { ip: string | null; userAgent: string | null }, now = new Date()): Promise<Result> {
  const id = verifyAgreementToken(token);
  if (!id) return { ok: false, error: "This signing link isn't valid." };
  if (input.agreed !== true) return { ok: false, error: "Tick the box to confirm you've read and agree to the agreement." };
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) return { ok: false, error: "Type your full name to sign." };
  if (name.length > 120) return { ok: false, error: "That name is too long." };

  return prisma.$transaction(async (tx): Promise<Result> => {
    const row = await tx.inspectionAgreement.findUnique({ where: { id }, select: { id: true, status: true, expiresAt: true, inspectionId: true, customerId: true, signerName: true } });
    if (!row || row.status === "REVOKED") return { ok: false, error: "This signing link was cancelled or replaced. Ask us for a new one." };
    if (row.status === "SIGNED") return { ok: true, data: undefined };
    if (row.expiresAt <= now) return { ok: false, error: "This signing link has expired. Ask us for a new one." };
    // Signed exactly once, even if the button is pressed twice.
    const { count } = await tx.inspectionAgreement.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "SIGNED", signedAt: now, signedName: name, signedIp: client.ip?.slice(0, 64) ?? null, signedUserAgent: client.userAgent?.slice(0, 400) ?? null },
    });
    if (count === 0) return { ok: true, data: undefined };
    await tx.inspection.updateMany({ where: { id: row.inspectionId, agreementSignedAt: null }, data: { agreementSignedAt: now } });
    const inspection = await tx.inspection.findUnique({ where: { id: row.inspectionId }, select: { transactionId: true } });
    await tx.communication.create({
      data: { inspectionId: row.inspectionId, transactionId: inspection?.transactionId, customerId: row.customerId, channel: "Online", direction: "INBOUND", summary: `Inspection agreement signed online by ${name}.`, occurredAt: now },
    });
    await logActivity(tx, { action: "inspection.agreement_signed_online", entityType: "Inspection", entityId: row.inspectionId, after: { agreementId: id, signedName: name, requestedFor: row.signerName, ip: client.ip } });
    return { ok: true, data: undefined };
  });
}
