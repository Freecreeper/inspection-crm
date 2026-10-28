import type { EmailProvider, OutboundEmail, SendResult } from "./types";

const API_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

// Resend tag names and values allow only ASCII letters, digits, "_" and "-".
const tagValue = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);

// Resend over plain fetch, mirroring the Postmark adapter. Resend has no message streams, so
// `stream` is not sent; opens and clicks are tracked per domain in Resend, off by default.
// https://resend.com/docs/api-reference/emails/send-email
export function createResendProvider(opts: { apiKey: string }): EmailProvider {
  return {
    name: "resend",
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
            Authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify({
            from: email.from,
            to: [email.to],
            reply_to: email.replyTo ?? undefined,
            subject: email.subject,
            text: email.text,
            html: email.html,
            headers: email.headers,
            tags: [{ name: "email_message_id", value: tagValue(email.metadata.emailMessageId) }],
          }),
        });
      } catch (err) {
        // An abort means the request may have reached Resend; anything
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
      const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (response.ok && body?.id) return { ok: true, providerMessageId: body.id };
      // 401/403 (bad key, unverified domain) and 422 (invalid email) won't succeed on a retry.
      return { ok: false, retryable: false, error: `Provider rejected the email: ${body?.message ?? `HTTP ${response.status}`}` };
    },
  };
}
