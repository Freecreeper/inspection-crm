import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
const send = vi.fn(async (_email: { to: string; text: string; subject: string }) => ({ ok: true as const, providerMessageId: "pm-1" }));
let simulated = false;
vi.mock("@/lib/email/providers", () => ({ getEmailProvider: () => ({ name: "fake", simulated, send }) }));

import { prisma } from "@/lib/prisma";
import { findResetToken, requestPasswordReset, resetPasswordWithToken } from "./passwordReset";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;
const NOW = new Date("2026-10-27T15:00:00Z");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  simulated = false;
  vi.stubEnv("APP_BASE_URL", "https://crm.example.com");
  vi.stubEnv("EMAIL_FROM", "noreply@crm.example.com");
  db.loginAttempt.findMany.mockResolvedValue([]);
  db.loginAttempt.findUnique.mockResolvedValue(null);
  db.emailSettings.findUnique.mockResolvedValue({ id: "default", fromName: "Acme Inspections", fromEmail: null, replyTo: null });
  db.activityLog.create.mockResolvedValue({});
});

describe("requesting a reset", () => {
  it("emails a one-hour link; only the token's hash is stored, and older links stop working", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u1", name: "Zack Bugg", email: "zack@example.com", active: true });
    await requestPasswordReset("  Zack@Example.com ", "203.0.113.9", NOW);

    expect(db.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", usedAt: null } });
    const stored = db.passwordResetToken.create.mock.calls[0][0].data;
    expect(stored).toMatchObject({ userId: "u1", expiresAt: new Date("2026-10-27T16:00:00Z"), requestedIp: "203.0.113.9" });

    const email = send.mock.calls[0][0];
    expect(email.to).toBe("zack@example.com");
    const raw = email.text.match(/https:\/\/crm\.example\.com\/reset-password\/(\S+)/)![1];
    expect(raw.length).toBeGreaterThanOrEqual(43); // 256 bits
    expect(stored.tokenHash).toBe(sha(raw));
    expect(JSON.stringify(stored)).not.toContain(raw);
    // Never goes through the email log (where the link would be stored).
    expect(db.emailMessage.create).not.toHaveBeenCalled();
  });

  it("an unknown or deactivated email gets the same silent treatment (no account discovery)", async () => {
    db.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "u2", name: "Gone", email: "gone@example.com", active: false });
    await expect(requestPasswordReset("nobody@example.com", null, NOW)).resolves.toBeUndefined();
    await expect(requestPasswordReset("gone@example.com", null, NOW)).resolves.toBeUndefined();
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("is throttled per email and address, so the form can't flood an inbox", async () => {
    db.loginAttempt.findMany.mockResolvedValue([{ lockedUntil: new Date(NOW.getTime() + 60_000) }]);
    db.user.findUnique.mockResolvedValue({ id: "u1", name: "Zack", email: "zack@example.com", active: true });
    await requestPasswordReset("zack@example.com", "203.0.113.9", NOW);
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(db.loginAttempt.findMany.mock.calls[0][0].where.key.in).toEqual(["resetEmail:zack@example.com", "resetIp:203.0.113.9"]);
  });

  it("with email delivery not configured, the link goes to the server log instead", async () => {
    simulated = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.user.findUnique.mockResolvedValue({ id: "u1", name: "Zack", email: "zack@example.com", active: true });
    await requestPasswordReset("zack@example.com", null, NOW);
    expect(send).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toMatch(/reset link for zack@example\.com .*https:\/\/crm\.example\.com\/reset-password\//);
    warn.mockRestore();
  });
});

describe("using a reset link", () => {
  const token = (over: Record<string, unknown> = {}) => ({ id: "t1", userId: "u1", expiresAt: new Date(NOW.getTime() + 30 * 60_000), usedAt: null, user: { email: "zack@example.com", active: true }, ...over });

  it("expired, used, or unknown links don't work", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(token({ expiresAt: new Date(NOW.getTime() - 1) }));
    expect(await findResetToken("raw", NOW)).toBeNull();
    db.passwordResetToken.findUnique.mockResolvedValue(token({ usedAt: NOW }));
    expect(await findResetToken("raw", NOW)).toBeNull();
    db.passwordResetToken.findUnique.mockResolvedValue(null);
    expect((await resetPasswordWithToken("raw", { next: "orchard-lantern-77", confirm: "orchard-lantern-77" }, NOW)).ok).toBe(false);
    expect(db.passwordResetToken.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { tokenHash: sha("raw") } }));
  });

  it("the new password follows the same rules", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(token());
    expect(await resetPasswordWithToken("raw", { next: "orchard-lantern-77", confirm: "different" }, NOW)).toEqual({ ok: false, error: "The new passwords don't match." });
    expect((await resetPasswordWithToken("raw", { next: "changeme1234", confirm: "changeme1234" }, NOW)).ok).toBe(false);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("sets the password, signs out every session, unlocks sign-in, and burns the link", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(token());
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    expect(await resetPasswordWithToken("raw", { next: "orchard-lantern-77", confirm: "orchard-lantern-77" }, NOW)).toEqual({ ok: true });
    expect(db.passwordResetToken.updateMany).toHaveBeenCalledWith({ where: { id: "t1", usedAt: null, expiresAt: { gt: NOW } }, data: { usedAt: NOW } });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: expect.objectContaining({ mustChangePassword: false, sessionVersion: { increment: 1 } }) });
    expect(db.loginAttempt.deleteMany).toHaveBeenCalledWith({ where: { key: "email:zack@example.com" } });
  });

  it("two uses of the same link at once: only the first succeeds", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(token());
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 0 }); // the other request claimed it
    expect((await resetPasswordWithToken("raw", { next: "orchard-lantern-77", confirm: "orchard-lantern-77" }, NOW)).ok).toBe(false);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
