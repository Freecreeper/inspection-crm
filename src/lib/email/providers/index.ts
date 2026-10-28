import { randomUUID } from "node:crypto";
import { getEmailConfig } from "../config";
import { createPostmarkProvider } from "./postmark";
import { createResendProvider } from "./resend";
import type { EmailProvider } from "./types";

export type { EmailProvider, OutboundEmail, SendResult } from "./types";

// Records the send and delivers nothing. Used whenever the environment is
// not explicitly configured to deliver (and always under test).
export const logProvider: EmailProvider = {
  name: "log",
  simulated: true,
  async send(email) {
    console.info(`[email] simulated send ${email.metadata.emailMessageId} (${email.stream}) — not delivered`);
    return { ok: true, providerMessageId: `simulated-${randomUUID()}` };
  },
};

let override: EmailProvider | null = null;

// Tests inject a fake provider; nothing else should call this.
export function setEmailProviderForTesting(provider: EmailProvider | null) {
  override = provider;
}

export function getEmailProvider(): EmailProvider {
  if (override) return override;
  const config = getEmailConfig();
  if (config.mode === "log") return logProvider;
  if (!config.postmarkToken) {
    return {
      name: "postmark",
      simulated: false,
      async send() {
        return { ok: false, retryable: false, error: "Email delivery is enabled but POSTMARK_API_TOKEN is not configured." };
      },
    };
  }
  return createPostmarkProvider({
    token: config.postmarkToken,
    transactionalStream: config.transactionalStream,
    broadcastStream: config.broadcastStream,
  });
}

export interface AccountMailer {
  provider: EmailProvider;
  from: string;
  replyTo: string | null;
}

// Mail about a staff member's own account (password resets) has its own switch, so it can be
// delivered while mail to customers and realtors is still simulated: with ACCOUNT_EMAIL_FROM and
// RESEND_API_KEY both set, it goes out through Resend whatever EMAIL_DELIVERY_MODE says. Null when
// that isn't configured (and under test unless a provider was injected); callers then fall back
// to getEmailProvider() and the business From address.
export function getAccountMailer(): AccountMailer | null {
  const config = getEmailConfig();
  if (!config.accountFrom || !config.resendApiKey) return null;
  if (process.env.VITEST && !override) return null;
  return {
    provider: override ?? createResendProvider({ apiKey: config.resendApiKey }),
    from: config.accountFrom,
    replyTo: config.accountReplyTo,
  };
}
