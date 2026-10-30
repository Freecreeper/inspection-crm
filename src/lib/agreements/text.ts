import { createHash } from "node:crypto";
import { renderTemplate } from "@/lib/email/render";
import type { EmailVariables } from "@/lib/email/variables";

// The built-in wording, used until an owner saves their own in Settings →
// Agreement. It is a placeholder, says so at the top, and is not legal
// advice: the business should replace it with an agreement reviewed by an
// attorney licensed in their state.
export const DEFAULT_AGREEMENT_TITLE = "Pre-Inspection Agreement";

export const DEFAULT_AGREEMENT_BODY = `PLACEHOLDER WORDING — replace this with your own agreement, reviewed by an attorney licensed in your state, before sending it to customers.

This agreement is between {{company.name | "the inspection company"}} ("we", "us") and {{customer.fullName | "the client"}} ("you") for a home inspection of {{property.address | "the property"}}, scheduled for {{inspection.date | "the agreed date"}}.

1. Services and fee
We will perform: {{inspection.type | "the services you ordered"}}. The fee is {{inspection.fee | "as quoted"}}, due by the time of the inspection unless we agree otherwise in writing.

2. Scope
The inspection is a visual, non-invasive examination of the readily accessible systems and components of the property as they appear on the day of the inspection. We do not move furniture, stored items or finished surfaces, and we do not test for hazardous materials unless that service is listed above.

3. Limitations
The inspection and report are not a warranty, guarantee or insurance policy, and are not a code-compliance or engineering evaluation. Conditions that are concealed, intermittent or develop later may not be found.

4. The report
The report is for your use. We may share it with the real estate professionals on your transaction if you ask us to.

5. Access
You are responsible for arranging access to the property, with utilities on.

6. Electronic signature
By typing your name and selecting "Sign agreement", you agree that your electronic signature is the legal equivalent of your handwritten signature, and that you consent to receive this agreement and do business with us electronically. You may ask us for a paper copy at any time.

Questions? Call us at {{company.phone | "the number on our website"}}.`;

// Placeholders the agreement wording can use, for the settings screen.
export const AGREEMENT_VARIABLES = [
  "customer.fullName",
  "property.address",
  "inspection.date",
  "inspection.time",
  "inspection.type",
  "inspection.fee",
  "inspector.name",
  "company.name",
  "company.phone",
  "company.website",
] as const;

const LEFTOVER = /\{\{[^{}]*\}\}/g;

// The text exactly as the customer will see and sign it. A placeholder
// with no value and no fallback becomes a blank to fill by hand rather
// than showing "{{…}}" in a signed document.
export function fillAgreement(template: string, vars: EmailVariables): { text: string; missing: string[] } {
  const rendered = renderTemplate(template, vars);
  return { text: rendered.text.replace(LEFTOVER, "________"), missing: [...rendered.missing, ...rendered.unknown] };
}

// A fingerprint of exactly what was signed.
export function agreementTextHash(title: string, body: string): string {
  return createHash("sha256").update(`${title}\n\n${body}`).digest("hex");
}
