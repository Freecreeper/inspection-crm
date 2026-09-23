import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Everything requires a staff session except the login page, the NextAuth API
// routes, and the customer/realtor report-delivery links (§13, §16) — those
// carry their own signed token, not a staff session. Runs on the Node.js
// runtime (Next.js 16's `proxy` convention), which is what lets this safely
// import the Prisma-backed auth config below.
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/r/"); // signed report-delivery links

  if (!req.auth && !isPublic) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Forwarded so the (app) layout's Server Component sidebar can highlight
  // the active nav item from `headers()` — no client-side JS (no
  // usePathname()) needed just for that.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
