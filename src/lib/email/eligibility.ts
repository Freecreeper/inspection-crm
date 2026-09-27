import type { EmailCategory, EmailRecipientType, Prisma, PrismaClient, SuppressionScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

// Which address-level suppressions block which category. An unsubscribe
// from marketing (MARKETING scope) never blocks an inspection confirmation;
// a hard bounce (ALL) blocks everything, because the address is dead.
export const BLOCKING_SCOPES: Record<EmailCategory, SuppressionScope[]> = {
  TRANSACTIONAL: ["ALL"],
  RELATIONSHIP: ["ALL", "NON_TRANSACTIONAL"],
  MARKETING: ["ALL", "NON_TRANSACTIONAL", "MARKETING"],
};

export interface RealtorPreferences {
  archivedAt: Date | null;
  relationshipEmailsEnabled: boolean;
  marketingOptIn: boolean;
  marketingUnsubscribedAt: Date | null;
}

export interface EligibilityInput {
  category: EmailCategory;
  recipientType: EmailRecipientType;
  email: string | null | undefined;
  realtor?: RealtorPreferences | null;
  suppressionScopes: SuppressionScope[];
  marketingRequiresOptIn: boolean;
}

export type Eligibility = { ok: true } | { ok: false; status: "SKIPPED" | "SUPPRESSED"; reason: string };

const WHO: Record<EmailRecipientType, string> = { CUSTOMER: "Customer", REALTOR: "Realtor", OTHER: "Recipient" };

// Pure decision, so every rule is testable without a database. Having an
// email address is necessary, never sufficient.
export function evaluateEligibility(input: EligibilityInput): Eligibility {
  if (!input.email?.trim()) return { ok: false, status: "SKIPPED", reason: `${WHO[input.recipientType]} email not provided` };

  const blocking = BLOCKING_SCOPES[input.category].filter((s) => input.suppressionScopes.includes(s));
  if (blocking.includes("ALL")) return { ok: false, status: "SUPPRESSED", reason: "Address is suppressed (bounced or deactivated)" };
  if (blocking.includes("NON_TRANSACTIONAL")) {
    return { ok: false, status: "SUPPRESSED", reason: "Recipient opted out of non-essential email (complaint or unsubscribe)" };
  }
  if (blocking.includes("MARKETING")) return { ok: false, status: "SUPPRESSED", reason: "Unsubscribed from marketing email" };

  const r = input.realtor;
  if (r && input.category !== "TRANSACTIONAL") {
    if (r.archivedAt) return { ok: false, status: "SKIPPED", reason: "Realtor is archived" };
    if (input.category === "RELATIONSHIP" && !r.relationshipEmailsEnabled) {
      return { ok: false, status: "SUPPRESSED", reason: "Relationship emails turned off for this realtor" };
    }
    if (input.category === "MARKETING") {
      if (r.marketingUnsubscribedAt) return { ok: false, status: "SUPPRESSED", reason: "Unsubscribed from marketing email" };
      if (input.marketingRequiresOptIn && !r.marketingOptIn) {
        return { ok: false, status: "SKIPPED", reason: "Not opted in to marketing email" };
      }
    }
  }
  return { ok: true };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function suppressionScopesFor(email: string | null | undefined, db: Db = prisma): Promise<SuppressionScope[]> {
  if (!email?.trim()) return [];
  const rows = await db.emailSuppression.findMany({ where: { email: normalizeEmail(email) }, select: { scope: true } });
  return rows.map((r) => r.scope);
}

export async function checkEligibility(
  args: Omit<EligibilityInput, "suppressionScopes" | "marketingRequiresOptIn"> & { marketingRequiresOptIn: boolean },
  db: Db = prisma
): Promise<Eligibility> {
  return evaluateEligibility({ ...args, suppressionScopes: await suppressionScopesFor(args.email, db) });
}
