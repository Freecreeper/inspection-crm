// Environment-driven email configuration. Secrets are read here and never
// returned to callers — describeEmailDelivery() is the only shape that
// reaches the UI.

export type DeliveryMode = "log" | "redirect" | "live";

export interface EmailConfig {
  mode: DeliveryMode;
  redirectTo: string | null;
  postmarkToken: string | null;
  transactionalStream: string;
  broadcastStream: string;
  defaultFromEmail: string | null;
  baseUrl: string;
  timeZone: string;
  webhookUsername: string | null;
  webhookPassword: string | null;
  workerSecret: string | null;
  batchSize: number;
}

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

// Nothing leaves the machine unless someone explicitly sets
// EMAIL_DELIVERY_MODE=live (or =redirect with a redirect address). An
// unset/unknown value is always "log", including in tests.
export function getEmailConfig(): EmailConfig {
  const rawMode = env("EMAIL_DELIVERY_MODE");
  const redirectTo = env("EMAIL_REDIRECT_TO");
  let mode: DeliveryMode = rawMode === "live" ? "live" : rawMode === "redirect" && redirectTo ? "redirect" : "log";
  if (process.env.VITEST) mode = "log";
  return {
    mode,
    redirectTo,
    postmarkToken: env("POSTMARK_API_TOKEN"),
    transactionalStream: env("POSTMARK_TRANSACTIONAL_STREAM") ?? "outbound",
    broadcastStream: env("POSTMARK_BROADCAST_STREAM") ?? "broadcast",
    defaultFromEmail: env("EMAIL_FROM"),
    baseUrl: (env("APP_BASE_URL") ?? env("NEXTAUTH_URL") ?? "http://localhost:3000").replace(/\/$/, ""),
    timeZone: env("APP_TIMEZONE") ?? "America/New_York",
    webhookUsername: env("POSTMARK_WEBHOOK_USERNAME"),
    webhookPassword: env("POSTMARK_WEBHOOK_PASSWORD"),
    workerSecret: env("EMAIL_WORKER_SECRET"),
    batchSize: Math.min(100, Math.max(1, Number(env("EMAIL_WORKER_BATCH") ?? 25) || 25)),
  };
}

export interface DeliveryDescription {
  mode: DeliveryMode;
  providerName: string;
  providerConfigured: boolean;
  webhookConfigured: boolean;
  delivers: boolean;
  summary: string;
  redirectTo: string | null;
}

// Safe, secret-free description for settings pages and banners.
export function describeEmailDelivery(config = getEmailConfig()): DeliveryDescription {
  const providerConfigured = Boolean(config.postmarkToken);
  const webhookConfigured = Boolean(config.webhookUsername && config.webhookPassword);
  const base = { providerName: "Postmark", providerConfigured, webhookConfigured, redirectTo: config.redirectTo, mode: config.mode };
  if (config.mode === "live") {
    return {
      ...base,
      delivers: providerConfigured,
      summary: providerConfigured
        ? "Live: emails are delivered to real recipients."
        : "Live mode is set, but no provider token is configured — sends will fail until POSTMARK_API_TOKEN is set.",
    };
  }
  if (config.mode === "redirect") {
    return {
      ...base,
      delivers: providerConfigured,
      summary: `Redirect: every email is delivered to ${config.redirectTo} instead of the real recipient.`,
    };
  }
  return {
    ...base,
    delivers: false,
    summary: "Simulated: emails go through the full pipeline but are not delivered to anyone.",
  };
}
