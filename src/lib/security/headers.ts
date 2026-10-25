// Pure. The Content-Security-Policy for every page, with a per-request
// nonce (src/proxy.ts). Next.js reads the nonce from this header while
// rendering and puts it on its own scripts, so only scripts the server
// emitted can run ('strict-dynamic' lets those load their chunks).
// Styles keep 'unsafe-inline': the app positions calendar events and
// similar UI with inline style attributes, which nonces can't cover.

export function contentSecurityPolicy(nonce: string, { dev = false }: { dev?: boolean } = {}): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

// Static headers for every response (next.config.ts).
export const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// Customer/realtor token links: never leak the token-bearing URL onward.
export const TOKEN_PAGE_HEADERS = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

export const HSTS_HEADER = { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" };
