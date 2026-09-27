import { randomUUID } from "node:crypto";
import { getEmailConfig } from "../config";
import { createPostmarkProvider } from "./postmark";
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
