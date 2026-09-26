import type { PreferredContactMethod } from "@prisma/client";

type NameFields = { firstName: string; lastName: string; preferredName?: string | null };

export function realtorDisplayName(r: NameFields): string {
  return `${r.preferredName?.trim() || r.firstName} ${r.lastName}`;
}

// Shown next to a preferred name so the legal name on file is never hidden.
export function realtorLegalNameIfDifferent(r: NameFields): string | null {
  const preferred = r.preferredName?.trim();
  if (!preferred || preferred === r.firstName) return null;
  return `${r.firstName} ${r.lastName}`;
}

export function brokerageLabel(b: { name: string; city?: string | null }): string {
  return b.city ? `${b.name} — ${b.city}` : b.name;
}

export const CONTACT_METHOD_LABELS: Record<PreferredContactMethod, string> = {
  PHONE: "Phone call",
  TEXT: "Text message",
  EMAIL: "Email",
};

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

// Amounts cross the server/client boundary as decimal strings (Prisma
// Decimal isn't serializable) and are only formatted, never re-summed, here.
export function formatCurrency(amount: string | null | undefined): string {
  if (amount == null) return "—";
  return currency.format(Number(amount));
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function smsHref(phone: string): string {
  return `sms:${phone.replace(/[^\d+]/g, "")}`;
}
