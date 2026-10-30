import { createHmac, timingSafeEqual } from "node:crypto";
import { getEmailConfig } from "@/lib/email/config";

// The signing link for one agreement request: its id plus an HMAC of it,
// keyed by AUTH_SECRET (the same scheme as unsubscribe links). Nothing
// secret is stored, so staff can copy or email the link at any time; it
// stops working when the request is signed, cancelled, replaced or expired
// — that's checked against the row, not the token.

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required to sign agreement links.");
  return value;
}

const sign = (id: string) => createHmac("sha256", secret()).update(`agreement:v1:${id}`).digest("base64url");

export function createAgreementToken(agreementId: string): string {
  return `${Buffer.from(agreementId).toString("base64url")}.${sign(agreementId)}`;
}

export function verifyAgreementToken(token: string): string | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const id = Buffer.from(payload, "base64url").toString();
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return null;
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return id;
}

export function agreementUrl(agreementId: string): string {
  return `${getEmailConfig().baseUrl}/a/${createAgreementToken(agreementId)}`;
}
