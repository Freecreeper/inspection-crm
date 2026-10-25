// Pure. Where a user may be sent after signing in. Only a same-site path is
// allowed: "/x" yes; "//evil.example", "/\evil.example", "https://…", or
// anything with control characters no — browsers treat "//" and "/\" as a
// different host (protocol-relative), which made /login?from=//evil.example
// an open redirect into a lookalike phishing page.

export const DEFAULT_AFTER_LOGIN = "/dashboard";

export function safeRedirectPath(raw: unknown, fallback = DEFAULT_AFTER_LOGIN): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2000) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // Never bounce back to the login page itself.
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login/")) return fallback;
  return raw;
}

// Auth.js's redirect callback: resolve against the site and keep only a
// same-origin path, or fall back to the Dashboard.
export function sameOriginRedirect(url: string, baseUrl: string): string {
  let target: URL;
  let base: URL;
  try {
    base = new URL(baseUrl);
    target = new URL(url, baseUrl);
  } catch {
    return `${baseUrl}${DEFAULT_AFTER_LOGIN}`;
  }
  if (target.origin !== base.origin) return `${base.origin}${DEFAULT_AFTER_LOGIN}`;
  const path = safeRedirectPath(`${target.pathname}${target.search}${target.hash}`);
  return `${base.origin}${path}`;
}
