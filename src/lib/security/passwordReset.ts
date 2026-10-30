import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { getEmailConfig } from "@/lib/email/config";
import { getEmailSettings } from "@/lib/email/settings";
import { getAccountMailer, getEmailProvider } from "@/lib/email/providers";
import { brandedEmailHtml } from "@/lib/email/render";
import { loadEmailBrand } from "@/lib/brand/service";
import { hashPassword, passwordProblem } from "./password";
import { clearFailures, lockedUntil, recordFailure } from "./loginThrottle";

// Self-service "Forgot password?". The request always answers the same way
// whether or not the email belongs to an account (no way to discover who
// works here). A reset link is a random 256-bit token; only its hash is
// stored, it expires after an hour, works once, and asking again replaces
// it. The email is handed straight to the provider (never written to the
// email log), so the link exists only in the recipient's inbox.

export const RESET_TTL_MS = 60 * 60_000;

const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

export type ResetResult = { ok: true } | { ok: false; error: string };

export async function requestPasswordReset(rawEmail: string, ip: string | null, now = new Date()): Promise<void> {
  const email = rawEmail.trim().toLowerCase().slice(0, 320);
  if (!email.includes("@")) return;
  const keys = [{ kind: "resetEmail" as const, value: email }, ...(ip ? [{ kind: "resetIp" as const, value: ip }] : [])];
  if (await lockedUntil(keys, now)) return;
  await recordFailure(keys, now);

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, active: true } });
  if (!user || !user.active) return;

  const raw = randomBytes(32).toString("base64url");
  await prisma.$transaction(async (tx) => {
    // Only the newest link works.
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(now.getTime() + RESET_TTL_MS), requestedIp: ip } });
    await logActivity(tx, { action: "user.password_reset_requested", entityType: "User", entityId: user.id, after: { ip } });
  });

  const config = getEmailConfig();
  const settings = await getEmailSettings();
  const link = `${config.baseUrl}/reset-password/${raw}`;
  const text = [
    `Hi ${user.name.split(" ")[0] || user.name},`,
    "",
    `Someone asked to reset the password for your ${settings.companyName} staff account. To choose a new password, open this link within the next hour:`,
    "",
    link,
    "",
    "If you didn't ask for this, you can ignore this email; your password stays the same.",
  ].join("\n");
  // A configured account sender (ACCOUNT_EMAIL_FROM + RESEND_API_KEY) delivers even while business
  // email is simulated; otherwise this follows the business provider and From address.
  const account = getAccountMailer();
  const provider = account?.provider ?? getEmailProvider();
  const businessFrom = settings.fromEmail ?? config.defaultFromEmail;
  const from = account?.from ?? (businessFrom ? `${settings.fromName} <${businessFrom}>` : null);
  if (provider.simulated || !from) {
    // No real delivery configured: the server log is the only place the
    // link can go, so whoever runs the server can pass it on.
    console.warn(`[password-reset] email delivery is not configured; reset link for ${user.email} (valid 1 hour): ${link}`);
    return;
  }
  const result = await provider.send({
    from,
    to: user.email,
    replyTo: account ? account.replyTo : settings.replyTo,
    subject: `Reset your ${settings.companyName} password`,
    text,
    html: brandedEmailHtml(text, await loadEmailBrand()),
    stream: "transactional",
    metadata: { emailMessageId: `password-reset-${user.id}` },
  });
  if (!result.ok) console.error(`[password-reset] couldn't send the reset email to user ${user.id}: ${result.error}`);
}

// Which account a link belongs to, if it's still usable.
export async function findResetToken(raw: string, now = new Date()) {
  if (!raw || raw.length > 200) return null;
  const token = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true, user: { select: { email: true, active: true } } },
  });
  if (!token || token.usedAt || token.expiresAt <= now || !token.user.active) return null;
  return token;
}

export async function resetPasswordWithToken(raw: string, input: { next: string; confirm: string }, now = new Date()): Promise<ResetResult> {
  const token = await findResetToken(raw, now);
  if (!token) return { ok: false, error: "This reset link has expired or was already used. Ask for a new one." };
  if (input.next !== input.confirm) return { ok: false, error: "The new passwords don't match." };
  const problem = passwordProblem(input.next ?? "", { email: token.user.email });
  if (problem) return { ok: false, error: problem };

  const passwordHash = await hashPassword(input.next);
  const claimed = await prisma.$transaction(async (tx) => {
    // Claim the token atomically so a link can't be used twice at once.
    const { count } = await tx.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (count === 0) return false;
    // New password, any temporary-password flag cleared, every existing
    // session signed out.
    await tx.user.update({ where: { id: token.userId }, data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } } });
    await tx.passwordResetToken.deleteMany({ where: { userId: token.userId, usedAt: null } });
    await logActivity(tx, { actorId: token.userId, action: "user.password_reset_completed", entityType: "User", entityId: token.userId });
    return true;
  });
  if (!claimed) return { ok: false, error: "This reset link has expired or was already used. Ask for a new one." };
  // A locked-out account can sign in again with its new password.
  await clearFailures(token.user.email);
  return { ok: true };
}
