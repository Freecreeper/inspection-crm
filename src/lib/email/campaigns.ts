import { z } from "zod";
import type { EmailCampaign, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { realtorIdsWithActivitySince } from "@/lib/realtors/directory";
import { realtorDisplayName } from "@/lib/realtors/display";
import { evaluateEligibility, normalizeEmail } from "./eligibility";
import { enqueueEmail } from "./queue";
import { getEmailSettings } from "./settings";

type Db = PrismaClient | Prisma.TransactionClient;

// A campaign audience is a small set of deterministic rules, combined with
// AND — never free-form SQL, never chosen by AI.
export const AudienceSchema = z.object({
  brokerageIds: z.array(z.string()).default([]),
  cities: z.array(z.string().trim().min(1)).default([]),
  activeWithinMonths: z.number().int().min(1).max(60).nullable().default(null),
  // When non-empty, the audience is exactly these realtors (still subject
  // to eligibility).
  realtorIds: z.array(z.string()).default([]),
});
export type Audience = z.infer<typeof AudienceSchema>;

export function parseAudience(raw: unknown): Audience {
  const parsed = AudienceSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : AudienceSchema.parse({});
}

export function describeAudience(a: Audience, brokerageNames: Map<string, string> = new Map()): string {
  const parts: string[] = [];
  if (a.realtorIds.length) parts.push(`${a.realtorIds.length} hand-picked realtor${a.realtorIds.length === 1 ? "" : "s"}`);
  else parts.push("All realtors");
  if (a.brokerageIds.length) parts.push(`at ${a.brokerageIds.map((id) => brokerageNames.get(id) ?? "a selected brokerage").join(", ")}`);
  if (a.cities.length) parts.push(`in ${a.cities.join(", ")}`);
  if (a.activeWithinMonths) parts.push(`with activity in the last ${a.activeWithinMonths} month${a.activeWithinMonths === 1 ? "" : "s"}`);
  return parts.join(" ");
}

export interface AudienceMember {
  realtorId: string;
  name: string;
  email: string | null;
  brokerage: string | null;
}

export interface AudiencePreview {
  eligible: AudienceMember[];
  excluded: (AudienceMember & { reason: string })[];
  reasons: { reason: string; count: number }[];
}

export async function resolveAudienceRealtors(audience: Audience, opts: { now?: Date; db?: Db } = {}) {
  const db = opts.db ?? prisma;
  const now = opts.now ?? new Date();
  const where: Prisma.RealtorWhereInput = { archivedAt: null };
  if (audience.realtorIds.length) where.id = { in: audience.realtorIds };
  if (audience.brokerageIds.length) where.brokerageId = { in: audience.brokerageIds };
  if (audience.cities.length) where.brokerage = { city: { in: audience.cities, mode: "insensitive" } };
  if (audience.activeWithinMonths) {
    const since = new Date(now);
    since.setMonth(since.getMonth() - audience.activeWithinMonths);
    const active = await realtorIdsWithActivitySince(since);
    where.AND = [{ id: { in: active } }];
  }
  return db.realtor.findMany({ where, include: { brokerage: { select: { name: true } } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
}

// Exactly what would happen if the campaign sent now: who gets it, who
// doesn't, and why. The same rules run again per recipient at send time.
export async function previewAudience(
  audience: Audience,
  category: "RELATIONSHIP" | "MARKETING",
  opts: { now?: Date; db?: Db } = {}
): Promise<AudiencePreview> {
  const db = opts.db ?? prisma;
  const [realtors, settings] = await Promise.all([resolveAudienceRealtors(audience, opts), getEmailSettings(db)]);
  const emails = [...new Set(realtors.map((r) => r.email).filter((e): e is string => Boolean(e)).map(normalizeEmail))];
  const suppressions = emails.length ? await db.emailSuppression.findMany({ where: { email: { in: emails } } }) : [];

  const eligible: AudienceMember[] = [];
  const excluded: AudiencePreview["excluded"] = [];
  const seenEmails = new Set<string>();
  for (const r of realtors) {
    const member = { realtorId: r.id, name: realtorDisplayName(r), email: r.email, brokerage: r.brokerage?.name ?? null };
    const email = r.email ? normalizeEmail(r.email) : null;
    const decision = evaluateEligibility({
      category,
      recipientType: "REALTOR",
      email: r.email,
      realtor: r,
      suppressionScopes: email ? suppressions.filter((s) => s.email === email).map((s) => s.scope) : [],
      marketingRequiresOptIn: settings.marketingRequiresOptIn,
    });
    if (!decision.ok) {
      excluded.push({ ...member, reason: decision.reason });
    } else if (seenEmails.has(email!)) {
      // Two realtor records sharing an address get one email, not two.
      excluded.push({ ...member, reason: "Duplicate email address in audience" });
    } else {
      seenEmails.add(email!);
      eligible.push(member);
    }
  }

  const counts = new Map<string, number>();
  for (const e of excluded) counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  return { eligible, excluded, reasons: [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) };
}

// Turns an approved campaign into one EmailMessage per recipient. Keyed by
// campaign+realtor, so re-running (after a crash, or twice) can never
// produce a second email to the same realtor. Runs in the worker, never
// in a web request.
export async function materializeCampaign(campaign: EmailCampaign, opts: { now?: Date; db?: Db } = {}) {
  const db = opts.db ?? prisma;
  const audience = parseAudience(campaign.audience);
  const category = campaign.category === "MARKETING" ? "MARKETING" : "RELATIONSHIP";
  const preview = await previewAudience(audience, category, opts);

  const members = [
    ...preview.eligible.map((m) => ({ ...m, reason: undefined as string | undefined })),
    ...preview.excluded.map((m) => ({ ...m, reason: m.reason as string | undefined })),
  ];
  for (const member of members) {
    await enqueueEmail(
      {
        mode: "REVIEW",
        category,
        templateId: campaign.templateId,
        subject: campaign.subject,
        body: campaign.body,
        recipient: { type: "REALTOR", name: member.name, email: member.email },
        refs: { realtorId: member.realtorId },
        campaignId: campaign.id,
        // Excluded recipients are recorded (so the campaign shows who didn't
        // get it and why) but never sent.
        skipReason: member.reason,
        idempotencyKey: `campaign:${campaign.id}:realtor:${member.realtorId}`,
        guard: { checks: [{ kind: "campaignActive", campaignId: campaign.id }] },
        createdById: campaign.approvedById,
        now: opts.now,
      },
      db
    );
  }
  return preview;
}
