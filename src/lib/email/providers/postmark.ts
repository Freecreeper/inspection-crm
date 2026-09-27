import type { EmailProvider, OutboundEmail, SendResult } from "./types";

const API_URL = "https://api.postmarkapp.com/email";
const TIMEOUT_MS = 15_000;

// Postmark error codes that mean "this recipient can't be mailed" rather
// than a problem with our request or with Postmark itself.
// https://postmarkapp.com/developer/api/overview#error-codes
const RECIPIENT_REFUSED = new Set([406]); // Inactive recipient (bounced/complained/unsubscribed)
const BAD_REQUEST = new Set([300, 400, 401, 402, 403, 405, 409, 410, 411, 412, 413, 1000]);

// Postmark over plain fetch — no SDK, so this file is the whole
// integration and a different provider is one new adapter.
export function createPostmarkProvider(opts: { token: string; transactionalStream: string; broadcastStream: string }): EmailProvider {
  return {
    name: "postmark",
    simulated: false,
    async send(email: OutboundEmail): Promise<SendResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(API_URL, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Postmark-Server-Token": opts.token,
          },
          body: JSON.stringify({
            From: email.from,
            To: email.to,
            ReplyTo: email.replyTo ?? undefined,
            Subject: email.subject,
            TextBody: email.text,
            HtmlBody: email.html,
            MessageStream: email.stream === "broadcast" ? opts.broadcastStream : opts.transactionalStream,
            Headers: Object.entries(email.headers ?? {}).map(([Name, Value]) => ({ Name, Value })),
            Metadata: email.metadata,
            TrackOpens: false,
            TrackLinks: "None",
          }),
        });
      } catch (err) {
        // An abort means the request may have reached Postmark; anything
        // else (DNS, refused connection) means it never left.
        const aborted = err instanceof Error && err.name === "AbortError";
        return aborted
          ? { ok: false, retryable: false, ambiguous: true, error: "Provider did not respond in time." }
          : { ok: false, retryable: true, error: "Could not reach the email provider." };
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 429 || response.status >= 500) {
        return { ok: false, retryable: true, error: `Provider temporarily unavailable (HTTP ${response.status}).` };
      }
      const body = (await response.json().catch(() => null)) as { ErrorCode?: number; Message?: string; MessageID?: string } | null;
      if (response.ok && body?.ErrorCode === 0 && body.MessageID) return { ok: true, providerMessageId: body.MessageID };

      const code = body?.ErrorCode ?? response.status;
      const message = body?.Message ?? `HTTP ${response.status}`;
      if (RECIPIENT_REFUSED.has(code)) return { ok: false, retryable: false, suppressed: true, error: `Provider refused recipient: ${message}` };
      if (BAD_REQUEST.has(code) || response.status < 500) return { ok: false, retryable: false, error: `Provider rejected the email: ${message}` };
      return { ok: false, retryable: true, error: `Provider error: ${message}` };
    },
  };
}
