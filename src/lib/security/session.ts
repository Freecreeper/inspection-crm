// Keeping a JWT session honest. The token is issued at sign-in, so on its
// own it would keep a fired or demoted employee's old role for as long as
// they kept using the app (Auth.js slides the expiry forward on every
// request). Every few minutes it is checked against the user row: a
// missing, deactivated, or revoked (sessionVersion changed) user is signed
// out, and the role, must-change-password flag and theme are refreshed.

import { encodeTheme, themeFromUiPreferences } from "@/lib/theme";

export const RECHECK_MS = 2 * 60_000;
// Idle sessions end after this long (sliding: each request extends it).
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export interface SessionToken {
  id?: string;
  sub?: string;
  role?: string;
  name?: string | null;
  email?: string | null;
  sv?: number;
  mcp?: boolean;
  // The user's saved theme, encoded (src/lib/theme); absent = none saved.
  theme?: string;
  checkedAt?: number;
  [key: string]: unknown;
}

export interface CurrentUser {
  id: string;
  active: boolean;
  role: string;
  name: string;
  email: string;
  sessionVersion: number;
  mustChangePassword: boolean;
  uiPreferences?: unknown;
}

export async function refreshSessionToken(
  token: SessionToken,
  now: number,
  loadUser: (id: string) => Promise<CurrentUser | null>
): Promise<SessionToken | null> {
  const id = token.id ?? token.sub;
  if (!id) return null;
  if (typeof token.checkedAt === "number" && now - token.checkedAt < RECHECK_MS && now >= token.checkedAt) return token;

  const user = await loadUser(id);
  if (!user || !user.active) return null;
  // Tokens from before sessionVersion existed carry none; treat as version 0.
  if ((token.sv ?? 0) !== user.sessionVersion) return null;

  const theme = themeFromUiPreferences(user.uiPreferences);
  return { ...token, id: user.id, role: user.role, name: user.name, email: user.email, sv: user.sessionVersion, mcp: user.mustChangePassword, theme: theme ? encodeTheme(theme) : undefined, checkedAt: now };
}
