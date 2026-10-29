import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { logActivity } from "./activity";
import { clearFailures, clientIp, lockedUntil, pruneAttempts, recordFailure, throttleKeys } from "./security/loginThrottle";
import { verifyPassword } from "./security/password";
import { sameOriginRedirect } from "./security/redirects";
import { refreshSessionToken, SESSION_MAX_AGE_SECONDS, type SessionToken } from "./security/session";
import { encodeTheme, themeFromUiPreferences } from "./theme";

// Too many recent failures for this email or address. The login page shows
// a "try again later" message; it is the same for real and unknown emails.
class LockedOut extends CredentialsSignin {
  code = "locked";
}

const loadCurrentUser = (id: string) =>
  prisma.user.findUnique({
    where: { id },
    select: { id: true, active: true, role: true, name: true, email: true, sessionVersion: true, mustChangePassword: true, uiPreferences: true },
  });

// Staff auth path (§13): credential sessions, JWT strategy. Customer/realtor
// report access is a separate signed-token path (see report delivery routes),
// deliberately not wired through this provider.
export const { handlers, auth, signIn, signOut, unstable_update: updateSession } = NextAuth({
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase().slice(0, 320) : undefined;
        const password = typeof credentials?.password === "string" ? credentials.password.slice(0, 1000) : undefined;
        if (!email || !password) return null;

        const keys = throttleKeys(email, clientIp(request?.headers));
        if (await lockedUntil(keys)) {
          await verifyPassword(password, null); // same work as a real attempt
          throw new LockedOut();
        }

        const user = await prisma.user.findUnique({ where: { email } });
        // Always run bcrypt, so unknown/inactive emails take as long as a
        // wrong password and timing doesn't reveal which accounts exist.
        const valid = await verifyPassword(password, user?.active ? user.passwordHash : null);
        if (!user || !user.active || !valid) {
          await recordFailure(keys);
          if (user) await logActivity(prisma, { action: "user.sign_in_failed", entityType: "User", entityId: user.id });
          return null;
        }

        await clearFailures(email);
        // Housekeeping: expired counters from anyone (cheap, indexed by key).
        void pruneAttempts().catch(() => undefined);
        const theme = themeFromUiPreferences(user.uiPreferences);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          sessionVersion: user.sessionVersion,
          mustChangePassword: user.mustChangePassword,
          theme: theme ? encodeTheme(theme) : undefined,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        const u = user as { id: string; role: string; sessionVersion?: number; mustChangePassword?: boolean; theme?: string };
        return { ...token, id: u.id, role: u.role, sv: u.sessionVersion ?? 0, mcp: u.mustChangePassword ?? false, theme: u.theme, checkedAt: Date.now() };
      }
      // A settings save asks for a fresh token (updateSession): re-read the
      // user now instead of at the next periodic check. The client can't
      // supply any values here — they always come from the database.
      if (trigger === "update") token.checkedAt = 0;
      // Re-checked against the user row every few minutes; null signs out.
      const refreshed = await refreshSessionToken(token as SessionToken, Date.now(), loadCurrentUser);
      return refreshed as typeof token | null;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.mustChangePassword = Boolean(token.mcp);
        session.user.theme = typeof token.theme === "string" ? token.theme : undefined;
      }
      return session;
    },
    // Only same-site paths after sign-in (no //evil.example open redirect).
    redirect({ url, baseUrl }) {
      return sameOriginRedirect(url, baseUrl);
    },
  },
  events: {
    // Signing out revokes this user's sessions everywhere, including a
    // cookie copied before sign-out.
    async signOut(message) {
      const id = "token" in message ? (message.token?.id as string | undefined) : undefined;
      if (id) await prisma.user.updateMany({ where: { id }, data: { sessionVersion: { increment: 1 } } });
    },
  },
});
