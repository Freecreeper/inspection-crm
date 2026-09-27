import { createHmac, timingSafeEqual } from "node:crypto";
import { getEmailConfig } from "./config";

// Signed, category-specific unsubscribe links for realtor relationship and
// marketing mail. The token names one realtor and one category, so a
// marketing unsubscribe can never switch off operational email.
export type UnsubscribeScope = "marketing" | "relationship";

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required to sign unsubscribe links.");
  return value;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(`unsubscribe:v1:${payload}`).digest("base64url");

export function createUnsubscribeToken(realtorId: string, scope: UnsubscribeScope): string {
  const payload = Buffer.from(`${realtorId}:${scope}`).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyUnsubscribeToken(token: string): { realtorId: string; scope: UnsubscribeScope } | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [realtorId, scope] = Buffer.from(payload, "base64url").toString().split(":");
  if (!realtorId || (scope !== "marketing" && scope !== "relationship")) return null;
  return { realtorId, scope };
}

export function unsubscribeUrl(realtorId: string, scope: UnsubscribeScope): string {
  return `${getEmailConfig().baseUrl}/u/${createUnsubscribeToken(realtorId, scope)}`;
}

export function oneClickUnsubscribeUrl(realtorId: string, scope: UnsubscribeScope): string {
  return `${getEmailConfig().baseUrl}/api/email/unsubscribe?t=${createUnsubscribeToken(realtorId, scope)}`;
}
