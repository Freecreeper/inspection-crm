import { describe, it, expect, vi, afterEach } from "vitest";
import { createResendProvider } from "./resend";
import { getAccountMailer, logProvider, setEmailProviderForTesting } from "./index";
import type { OutboundEmail } from "./types";

const email: OutboundEmail = {
  from: "Inspection CRM <no-reply@n3rdlabs.example>",
  to: "zack@example.com",
  replyTo: null,
  subject: "Reset your Inspection CRM password",
  text: "Hi",
  html: "<p>Hi</p>",
  stream: "transactional",
  metadata: { emailMessageId: "password-reset-u1" },
};

const respond = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setEmailProviderForTesting(null);
});

describe("Resend adapter", () => {
  const provider = createResendProvider({ apiKey: "re_test" });

  it("posts the email with the API key and returns Resend's id", async () => {
    respond(200, { id: "re-msg-1" });
    await expect(provider.send(email)).resolves.toEqual({ ok: true, providerMessageId: "re-msg-1" });

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: email.from, to: ["zack@example.com"], subject: email.subject, text: "Hi", html: "<p>Hi</p>" });
    expect(body.tags).toEqual([{ name: "email_message_id", value: "password-reset-u1" }]);
    expect(body).not.toHaveProperty("stream");
  });

  it("retries only what Resend definitely didn't accept", async () => {
    respond(429, { message: "Too many requests" });
    await expect(provider.send(email)).resolves.toMatchObject({ ok: false, retryable: true });
    respond(503, {});
    await expect(provider.send(email)).resolves.toMatchObject({ ok: false, retryable: true });

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(provider.send(email)).resolves.toMatchObject({ ok: false, retryable: true });

    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(abort)));
    await expect(provider.send(email)).resolves.toMatchObject({ ok: false, retryable: false, ambiguous: true });
  });

  it("a rejected key, unverified domain or invalid email is final, with Resend's reason", async () => {
    respond(403, { name: "validation_error", message: "The n3rdlabs.example domain is not verified." });
    await expect(provider.send(email)).resolves.toEqual({
      ok: false,
      retryable: false,
      error: "Provider rejected the email: The n3rdlabs.example domain is not verified.",
    });
  });
});

describe("account mailer", () => {
  it("is off unless both ACCOUNT_EMAIL_FROM and RESEND_API_KEY are set", () => {
    setEmailProviderForTesting(logProvider);
    vi.stubEnv("ACCOUNT_EMAIL_FROM", "Inspection CRM <no-reply@n3rdlabs.example>");
    expect(getAccountMailer()).toBeNull();
    vi.stubEnv("ACCOUNT_EMAIL_FROM", "");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(getAccountMailer()).toBeNull();
  });

  it("uses the configured sender, whatever EMAIL_DELIVERY_MODE says", () => {
    setEmailProviderForTesting(logProvider);
    vi.stubEnv("EMAIL_DELIVERY_MODE", "log");
    vi.stubEnv("ACCOUNT_EMAIL_FROM", "Inspection CRM <no-reply@n3rdlabs.example>");
    vi.stubEnv("ACCOUNT_EMAIL_REPLY_TO", "help@n3rdlabs.example");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(getAccountMailer()).toEqual({
      provider: logProvider,
      from: "Inspection CRM <no-reply@n3rdlabs.example>",
      replyTo: "help@n3rdlabs.example",
    });
  });

  it("never builds a real provider under test", () => {
    vi.stubEnv("ACCOUNT_EMAIL_FROM", "Inspection CRM <no-reply@n3rdlabs.example>");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(getAccountMailer()).toBeNull();
  });
});
