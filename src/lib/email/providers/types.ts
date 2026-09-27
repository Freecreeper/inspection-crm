// The only contract business code relies on. Nothing outside
// src/lib/email/providers knows which provider is in use.

export interface OutboundEmail {
  from: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  html: string;
  stream: "transactional" | "broadcast";
  headers?: Record<string, string>;
  // Correlates provider events back to our EmailMessage.
  metadata: { emailMessageId: string };
}

export type SendResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      error: string;
      // Safe to try again: the provider definitely did not accept it.
      retryable: boolean;
      // We can't tell whether it was accepted (e.g. a timeout after the
      // request went out). Never retried automatically, to avoid duplicates.
      ambiguous?: boolean;
      // The provider refuses this recipient (bounced/unsubscribed there).
      suppressed?: boolean;
    };

export interface EmailProvider {
  name: string;
  // True when this provider only records the send and delivers nothing.
  simulated: boolean;
  send(email: OutboundEmail): Promise<SendResult>;
}
