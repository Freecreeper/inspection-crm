import { prisma } from "@/lib/prisma";

// Throttles password guessing, per account and per client IP, in Postgres
// so it holds across every app process. Counting failures for any email —
// real or not — means a lockout reveals nothing about which accounts exist.
//
// Account: 8 failures in 15 minutes locks that email for 15 minutes.
// IP:      40 failures in 15 minutes locks that address for 15 minutes.
// A successful sign-in clears the account's counter.

export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;
// email/ip: failed sign-ins. resetEmail/resetIp: password-reset requests
// (every request counts), so the reset form can't be used to flood an inbox.
export const LIMITS = { email: 8, ip: 40, resetEmail: 3, resetIp: 10 } as const;

export type ThrottleKey = { kind: keyof typeof LIMITS; value: string };

const keyOf = (k: ThrottleKey) => `${k.kind}:${k.value.toLowerCase()}`;

// The client address as reported by the proxy in front of the app (Caddy
// sets X-Forwarded-For). Best effort: the per-account limit is the one
// that can't be dodged by changing address.
export function clientIp(headers: Headers | undefined | null): string | null {
  if (!headers) return null;
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || null;
}

export function throttleKeys(email: string, ip: string | null): ThrottleKey[] {
  return [{ kind: "email", value: email }, ...(ip ? [{ kind: "ip" as const, value: ip }] : [])];
}

// When the earliest lock among these keys ends, or null if none is locked.
export async function lockedUntil(keys: ThrottleKey[], now = new Date()): Promise<Date | null> {
  const rows = await prisma.loginAttempt.findMany({ where: { key: { in: keys.map(keyOf) }, lockedUntil: { gt: now } }, select: { lockedUntil: true } });
  const ends = rows.map((r) => r.lockedUntil!.getTime());
  return ends.length ? new Date(Math.max(...ends)) : null;
}

export async function recordFailure(keys: ThrottleKey[], now = new Date()): Promise<void> {
  const floor = new Date(now.getTime() - WINDOW_MS);
  for (const k of keys) {
    const key = keyOf(k);
    const existing = await prisma.loginAttempt.findUnique({ where: { key } });
    const fresh = !existing || existing.windowStart < floor;
    const count = fresh ? 1 : existing.count + 1;
    const lock = count >= LIMITS[k.kind] ? new Date(now.getTime() + LOCK_MS) : (existing?.lockedUntil ?? null);
    await prisma.loginAttempt.upsert({
      where: { key },
      create: { key, windowStart: now, count, lockedUntil: lock },
      update: { windowStart: fresh ? now : existing.windowStart, count, lockedUntil: lock },
    });
  }
}

export async function clearFailures(email: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { key: keyOf({ kind: "email", value: email }) } });
}

// Old rows are useless after their window and any lock have passed.
export async function pruneAttempts(now = new Date()): Promise<void> {
  const floor = new Date(now.getTime() - WINDOW_MS - LOCK_MS);
  await prisma.loginAttempt.deleteMany({ where: { updatedAt: { lt: floor } } });
}
