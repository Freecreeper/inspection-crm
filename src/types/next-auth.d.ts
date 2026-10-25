import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
    sessionVersion?: number;
    mustChangePassword?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    // sessionVersion the token was issued with; must match the user row.
    sv?: number;
    // mustChangePassword, refreshed with the periodic re-check.
    mcp?: boolean;
    checkedAt?: number;
  }
}
