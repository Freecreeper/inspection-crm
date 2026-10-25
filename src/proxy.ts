import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { contentSecurityPolicy, newNonce } from "@/lib/security/headers";

// Everything requires a staff session except the login page, the NextAuth API
// routes, and the customer/realtor report-delivery links (§13, §16) — those
// carry their own signed token, not a staff session. Runs on the Node.js
// runtime (Next.js 16's `proxy` convention), which is what lets this safely
// import the Prisma-backed auth config below.
//
// Every response also gets a Content-Security-Policy with a fresh nonce;
// Next.js reads it from the request headers and applies it to its scripts.
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/r/") || // signed report-delivery links
    pathname.startsWith("/u/") || // signed email-preference links
    pathname === "/api/email/unsubscribe" || // one-click unsubscribe (signed token)
    pathname === "/api/webhooks/postmark" || // Basic-auth verified in the route
    pathname === "/api/cron/email"; // bearer-secret verified in the route

  if (!req.auth && !isPublic) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // A temporary password (new user, admin reset) must be replaced first.
  if (req.auth?.user?.mustChangePassword && !isPublic && pathname !== "/account/password") {
    return NextResponse.redirect(new URL("/account/password", req.nextUrl.origin));
  }

  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === "development" });
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
