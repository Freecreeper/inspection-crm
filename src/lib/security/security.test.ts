import { describe, it, expect, vi } from "vitest";
import { safeRedirectPath, sameOriginRedirect } from "./redirects";
import { checkEnvironment } from "./env";
import { passwordProblem } from "./passwordRules";
import { refreshSessionToken, RECHECK_MS, type CurrentUser } from "./session";
import { contentSecurityPolicy } from "./headers";
import { clientIp } from "./loginThrottle";

describe("post-login redirects (open redirect)", () => {
  it("allows same-site paths only", () => {
    expect(safeRedirectPath("/calendar?view=week")).toBe("/calendar?view=week");
    for (const bad of ["//evil.example", "//evil.example/x", "/\\evil.example", "https://evil.example", "http:/evil", "evil", "", "/login", "/login?x=1", "/ok\n", null, 42]) {
      expect(safeRedirectPath(bad), String(bad)).toBe("/dashboard");
    }
  });

  it("Auth.js redirect callback keeps only same-origin paths", () => {
    const base = "https://crm.n3rdlabs.dev";
    expect(sameOriginRedirect("/tasks", base)).toBe(`${base}/tasks`);
    expect(sameOriginRedirect(`${base}/inspections/1`, base)).toBe(`${base}/inspections/1`);
    expect(sameOriginRedirect("//evil.example/x", base)).toBe(`${base}/dashboard`);
    expect(sameOriginRedirect("/\\evil.example", base)).toBe(`${base}/dashboard`);
    expect(sameOriginRedirect("https://evil.example/", base)).toBe(`${base}/dashboard`);
  });
});

describe("startup configuration", () => {
  const good = { NODE_ENV: "production", AUTH_SECRET: "x".repeat(44), DATABASE_URL: "postgres://db", APP_BASE_URL: "https://crm.example.com", AUTH_URL: "https://crm.example.com", APP_TIMEZONE: "America/New_York" };

  it("a correct production config passes", () => {
    expect(checkEnvironment(good)).toEqual({ errors: [], warnings: [] });
  });

  it("refuses the published placeholder, the CI secret, a short or missing secret in production", () => {
    for (const AUTH_SECRET of ["replace-with-a-generated-secret", "ci-only-not-a-real-secret-00000000000000000000000000", "short", "", undefined]) {
      expect(checkEnvironment({ ...good, AUTH_SECRET }).errors.length, String(AUTH_SECRET)).toBe(1);
    }
  });

  it("refuses a bad time zone anywhere, and localhost/http base URLs in production", () => {
    expect(checkEnvironment({ ...good, NODE_ENV: "development", APP_TIMEZONE: "America/NewYork" }).errors).toHaveLength(1);
    expect(checkEnvironment({ ...good, APP_BASE_URL: "http://crm.example.com" }).errors[0]).toMatch(/https/);
    expect(checkEnvironment({ ...good, APP_BASE_URL: "https://localhost:3000" }).errors[0]).toMatch(/localhost/);
    expect(checkEnvironment({ ...good, APP_BASE_URL: undefined, AUTH_URL: undefined, NEXTAUTH_URL: undefined }).errors[0]).toMatch(/APP_BASE_URL/);
  });

  it("in development the same problems are only warnings", () => {
    const dev = checkEnvironment({ NODE_ENV: "development", AUTH_SECRET: "replace-with-a-generated-secret", DATABASE_URL: "postgres://db" });
    expect(dev.errors).toEqual([]);
    expect(dev.warnings.length).toBeGreaterThan(0);
  });

  it("live email needs its Postmark credentials", () => {
    expect(checkEnvironment({ ...good, EMAIL_DELIVERY_MODE: "live" }).errors).toHaveLength(3);
  });
});

describe("password rules", () => {
  it("length over complexity, no published or common passwords, not the email name", () => {
    expect(passwordProblem("short")).toMatch(/12 characters/);
    expect(passwordProblem("changeme1234")).toMatch(/too common/);
    expect(passwordProblem("CHANGEME1234")).toMatch(/too common/); // case doesn't help
    expect(passwordProblem("orchard-lantern-77")).toBeNull();
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/easy/);
    expect(passwordProblem("zack.b-garden-ladder", { email: "zack.b@example.com" })).toMatch(/email/);
    expect(passwordProblem("blue-river-ladder-42", { current: "blue-river-ladder-42" })).toMatch(/haven't used/);
    expect(passwordProblem("blue-river-ladder-42", { email: "owner@example.com" })).toBeNull();
  });
});

describe("session re-check (deactivated / demoted / revoked staff)", () => {
  const user: CurrentUser = { id: "u1", active: true, role: "OFFICE_STAFF", name: "Pat", email: "pat@example.com", sessionVersion: 3, mustChangePassword: false };
  const token = { id: "u1", role: "OWNER_ADMIN", sv: 3, checkedAt: 0 };
  const NOW = 10 * RECHECK_MS;

  it("refreshes the role from the user row (a demotion takes effect)", async () => {
    const out = await refreshSessionToken(token, NOW, async () => user);
    expect(out).toMatchObject({ role: "OFFICE_STAFF", sv: 3, checkedAt: NOW, mcp: false });
  });

  it("signs out a deactivated, deleted, or revoked user", async () => {
    expect(await refreshSessionToken(token, NOW, async () => ({ ...user, active: false }))).toBeNull();
    expect(await refreshSessionToken(token, NOW, async () => null)).toBeNull();
    expect(await refreshSessionToken(token, NOW, async () => ({ ...user, sessionVersion: 4 }))).toBeNull();
  });

  it("carries the user's saved theme, and drops a malformed one", async () => {
    const token = { id: "u1", role: "OFFICE_STAFF", sv: 3, checkedAt: NOW - RECHECK_MS - 1 };
    const saved = { version: 1, theme: { appearance: "dark", palette: "coastal" } };
    expect(await refreshSessionToken(token, NOW, async () => ({ ...user, uiPreferences: saved }))).toMatchObject({ theme: "dark:coastal" });
    expect((await refreshSessionToken(token, NOW, async () => ({ ...user, uiPreferences: { version: 99, theme: {} } })))?.theme).toBeUndefined();
    expect((await refreshSessionToken(token, NOW, async () => ({ ...user, uiPreferences: null })))?.theme).toBeUndefined();
  });

  it("a forged token for a made-up id is rejected", async () => {
    expect(await refreshSessionToken({ id: "nobody", role: "OWNER_ADMIN" }, NOW, async () => null)).toBeNull();
    expect(await refreshSessionToken({ role: "OWNER_ADMIN" }, NOW, async () => user)).toBeNull();
  });

  it("is throttled: a recently checked token isn't looked up again", async () => {
    const load = vi.fn(async () => user);
    const fresh = { ...token, checkedAt: NOW - 1000 };
    expect(await refreshSessionToken(fresh, NOW, load)).toBe(fresh);
    expect(load).not.toHaveBeenCalled();
    // A token from before sessionVersion existed counts as version 0.
    expect(await refreshSessionToken({ id: "u1" }, NOW, async () => ({ ...user, sessionVersion: 0 }))).toMatchObject({ sv: 0 });
  });
});

describe("Content-Security-Policy", () => {
  it("only nonce'd scripts run; no framing, plugins, or foreign forms", () => {
    const csp = contentSecurityPolicy("abc123");
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "upgrade-insecure-requests"]) expect(csp).toContain(d);
    // Development needs eval for React's error overlay and websockets for HMR.
    expect(contentSecurityPolicy("n", { dev: true })).toMatch(/'unsafe-eval'.*connect-src 'self' ws: wss:/);
  });
});

describe("client address for throttling", () => {
  it("uses the first forwarded address, then X-Real-IP", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBeNull();
  });
});
