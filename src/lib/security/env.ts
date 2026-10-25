// Startup configuration checks (src/instrumentation.ts and the email worker
// run these before serving anything). In production a dangerous setting
// stops the process instead of quietly working: a guessable AUTH_SECRET
// lets anyone mint an owner session, an invalid time zone breaks every
// Calendar/email render, and a non-https or missing base URL sends
// customers dead localhost links.

// Values that must never sign production sessions: the old .env.example
// placeholder and the throwaway CI secret, both published in the repo.
export const PUBLISHED_SECRETS = new Set([
  "replace-with-a-generated-secret",
  "ci-only-not-a-real-secret-00000000000000000000000000",
]);

export const MIN_SECRET_LENGTH = 32;

export interface EnvReport {
  errors: string[];
  warnings: string[];
}

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function checkEnvironment(env: Record<string, string | undefined>): EnvReport {
  const production = env.NODE_ENV === "production";
  const errors: string[] = [];
  const warnings: string[] = [];
  const problem = (message: string) => (production ? errors : warnings).push(message);

  const secret = env.AUTH_SECRET?.trim() ?? "";
  if (!secret) problem("AUTH_SECRET is not set. Generate one with `npx auth secret`.");
  else if (PUBLISHED_SECRETS.has(secret)) problem("AUTH_SECRET is a value published in the repository. Generate a new one with `npx auth secret`.");
  else if (secret.length < MIN_SECRET_LENGTH) problem(`AUTH_SECRET is too short (${secret.length} characters; at least ${MIN_SECRET_LENGTH}).`);

  if (!env.DATABASE_URL?.trim()) problem("DATABASE_URL is not set.");

  const tz = env.APP_TIMEZONE?.trim();
  // An invalid zone fails every render either way, so it's an error everywhere.
  if (tz && !validTimeZone(tz)) errors.push(`APP_TIMEZONE "${tz}" is not a valid IANA time zone (e.g. America/New_York).`);

  const base = env.APP_BASE_URL?.trim() || env.AUTH_URL?.trim() || env.NEXTAUTH_URL?.trim();
  if (!base) {
    problem("APP_BASE_URL is not set, so report and unsubscribe links in emails would point at localhost.");
  } else {
    let url: URL | null = null;
    try {
      url = new URL(base);
    } catch {
      errors.push(`APP_BASE_URL "${base}" is not a valid URL.`);
    }
    if (url && production && url.protocol !== "https:") errors.push(`APP_BASE_URL must use https in production (got ${url.protocol}//${url.host}).`);
    if (url && production && /^(localhost|127\.|0\.0\.0\.0)/.test(url.hostname)) errors.push("APP_BASE_URL points at localhost in production.");
  }

  if (production && !env.AUTH_URL && env.AUTH_TRUST_HOST !== "true") {
    warnings.push("Neither AUTH_URL nor AUTH_TRUST_HOST=true is set; Auth.js rejects requests from an untrusted host in production.");
  }

  if (env.EMAIL_DELIVERY_MODE === "live") {
    for (const name of ["POSTMARK_API_TOKEN", "POSTMARK_WEBHOOK_USERNAME", "POSTMARK_WEBHOOK_PASSWORD"]) {
      if (!env[name]?.trim()) problem(`EMAIL_DELIVERY_MODE=live but ${name} is not set.`);
    }
  }

  return { errors, warnings };
}

// Logs warnings and throws on errors. `where` names the process for the log.
export function assertEnvironment(where: string, env: Record<string, string | undefined> = process.env): void {
  const { errors, warnings } = checkEnvironment(env);
  for (const w of warnings) console.warn(`[config:${where}] ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`[config:${where}] ${e}`);
    throw new Error(`Refusing to start: ${errors.length} configuration problem${errors.length === 1 ? "" : "s"} (see above).`);
  }
}
