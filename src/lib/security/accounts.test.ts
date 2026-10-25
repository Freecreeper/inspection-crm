import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { LIMITS, lockedUntil, recordFailure, throttleKeys, WINDOW_MS } from "./loginThrottle";
import { verifyPassword } from "./password";
import { changeOwnPassword, changeRole, createUser, resetPassword, setActive } from "@/lib/users";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  db.activityLog.create.mockResolvedValue({});
});

describe("sign-in throttling", () => {
  it(`locks an email after ${LIMITS.email} failures in the window, whether or not the account exists`, async () => {
    const rows = new Map<string, { key: string; windowStart: Date; count: number; lockedUntil: Date | null }>();
    db.loginAttempt.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null);
    db.loginAttempt.upsert.mockImplementation(async ({ where, create, update }: { where: { key: string }; create: never; update: Record<string, unknown> }) => {
      const prev = rows.get(where.key);
      rows.set(where.key, prev ? { ...prev, ...update } : create);
    });
    const now = new Date("2026-10-25T12:00:00Z");
    const keys = throttleKeys("Nobody@Example.com", "203.0.113.9");
    for (let i = 0; i < LIMITS.email - 1; i++) await recordFailure(keys, now);
    expect(rows.get("email:nobody@example.com")).toMatchObject({ count: LIMITS.email - 1, lockedUntil: null });
    await recordFailure(keys, now);
    expect(rows.get("email:nobody@example.com")!.lockedUntil).toEqual(new Date(now.getTime() + 15 * 60_000));
    expect(rows.get("ip:203.0.113.9")).toMatchObject({ count: LIMITS.email, lockedUntil: null }); // IP limit is higher

    // After the window passes, counting starts over.
    await recordFailure(keys, new Date(now.getTime() + WINDOW_MS + 1));
    expect(rows.get("ip:203.0.113.9")!.count).toBe(1);
  });

  it("reports the lock end for any locked key", async () => {
    const until = new Date("2026-10-25T12:15:00Z");
    db.loginAttempt.findMany.mockResolvedValue([{ lockedUntil: until }]);
    expect(await lockedUntil(throttleKeys("a@b.co", null), new Date("2026-10-25T12:01:00Z"))).toEqual(until);
    expect(db.loginAttempt.findMany).toHaveBeenCalledWith({ where: { key: { in: ["email:a@b.co"] }, lockedUntil: { gt: new Date("2026-10-25T12:01:00Z") } }, select: { lockedUntil: true } });
  });

  it("unknown accounts still cost a real bcrypt comparison (no timing tell) and never verify", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][1])).toMatch(/^\$2[aby]\$12\$/);
  });
});

describe("user management", () => {
  it("a new user gets a one-time password, stored only as a hash, and must change it", async () => {
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "u9", ...data }));
    const result = await createUser("owner", { name: "Pat Office", email: "Pat@Example.com", role: "OFFICE_STAFF" });
    expect(result).toMatchObject({ ok: true, data: { id: "u9", email: "pat@example.com" } });
    const temp = result.ok ? result.data.temporaryPassword : "";
    const data = db.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ email: "pat@example.com", role: "OFFICE_STAFF", mustChangePassword: true });
    expect(data.passwordHash).not.toContain(temp);
    expect(await bcrypt.compare(temp, data.passwordHash)).toBe(true);
    expect(db.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "user.created", actorId: "owner" }) });
  });

  it("refuses a duplicate email or an unknown role", async () => {
    db.user.findUnique.mockResolvedValue({ id: "taken" });
    expect(await createUser("owner", { name: "A", email: "a@b.co", role: "OFFICE_STAFF" })).toEqual({ ok: false, error: "Someone already uses that email address." });
    expect((await createUser("owner", { name: "A", email: "a@b.co", role: "SUPERUSER" })).ok).toBe(false);
  });

  it("the business can't lock itself out: no self-demotion/deactivation, and the last owner stays", async () => {
    expect(await changeRole("owner", "owner", "INSPECTOR")).toEqual({ ok: false, error: "You can't change your own role." });
    expect(await setActive("owner", "owner", false)).toEqual({ ok: false, error: "You can't deactivate yourself." });

    db.user.findUnique.mockResolvedValue({ role: "OWNER_ADMIN", active: true });
    db.user.count.mockResolvedValue(0);
    expect((await setActive("owner2", "owner", false)).ok).toBe(false);
    expect((await changeRole("owner2", "owner", "OFFICE_STAFF")).ok).toBe(false);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("deactivating revokes sessions at once; a password reset does too and forces a new password", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u2", role: "INSPECTOR", active: true });
    expect(await setActive("owner", "u2", false)).toEqual({ ok: true, data: undefined });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u2" }, data: { active: false, sessionVersion: { increment: 1 } } });

    const reset = await resetPassword("owner", "u2");
    expect(reset.ok).toBe(true);
    expect(db.user.update).toHaveBeenLastCalledWith({ where: { id: "u2" }, data: expect.objectContaining({ mustChangePassword: true, sessionVersion: { increment: 1 } }) });
  });

  it("changing your own password needs the current one, follows the rules, and signs out everywhere", async () => {
    const hash = await bcrypt.hash("old-password-here", 4);
    db.user.findUnique.mockResolvedValue({ email: "pat@example.com", passwordHash: hash, active: true });
    expect(await changeOwnPassword("u1", { current: "wrong", next: "orchard-lantern-77", confirm: "orchard-lantern-77" })).toEqual({ ok: false, error: "Your current password is incorrect." });
    expect(await changeOwnPassword("u1", { current: "old-password-here", next: "orchard-lantern-77", confirm: "different" })).toEqual({ ok: false, error: "The new passwords don't match." });
    expect((await changeOwnPassword("u1", { current: "old-password-here", next: "changeme1234", confirm: "changeme1234" })).ok).toBe(false);
    expect(db.user.update).not.toHaveBeenCalled();

    expect(await changeOwnPassword("u1", { current: "old-password-here", next: "orchard-lantern-77", confirm: "orchard-lantern-77" })).toEqual({ ok: true, data: undefined });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: expect.objectContaining({ mustChangePassword: false, sessionVersion: { increment: 1 } }) });
  });
});
