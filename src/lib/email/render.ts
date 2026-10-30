import { SEND_TIME_KEYS, VARIABLE_KEYS, type EmailVariables } from "./variables";

// {{ key }} or {{ key | "fallback" }}. The fallback is text the template
// author chose — it's the only substitute ever used for a missing value.
const PLACEHOLDER = /\{\{\s*([a-zA-Z][\w.]*)\s*(?:\|\s*"([^"{}]*)"\s*)?\}\}/g;

export interface RenderResult {
  text: string;
  // Referenced, allowed, but no value available and no fallback given.
  missing: string[];
  // Referenced but not an allowed variable at all.
  unknown: string[];
  // Allowed send-time variables, left in place for the worker to fill.
  deferred: string[];
}

export function renderTemplate(template: string, vars: EmailVariables, opts: { resolveSendTime?: boolean } = {}): RenderResult {
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const deferred = new Set<string>();

  const text = template.replace(PLACEHOLDER, (match, key: string, fallback: string | undefined) => {
    if (!VARIABLE_KEYS.has(key)) {
      unknown.add(key);
      return match;
    }
    if (SEND_TIME_KEYS.has(key) && !opts.resolveSendTime) {
      deferred.add(key);
      return match;
    }
    const value = vars[key];
    if (value != null && value !== "") return value;
    if (fallback !== undefined) return fallback;
    missing.add(key);
    return match;
  });

  return { text, missing: [...missing], unknown: [...unknown], deferred: [...deferred] };
}

export function renderSubjectAndBody(subject: string, body: string, vars: EmailVariables, opts?: { resolveSendTime?: boolean }) {
  const s = renderTemplate(subject, vars, opts);
  const b = renderTemplate(body, vars, opts);
  const merge = (a: string[], c: string[]) => [...new Set([...a, ...c])];
  return {
    subject: s.text,
    body: b.text,
    missing: merge(s.missing, b.missing),
    unknown: merge(s.unknown, b.unknown),
    deferred: merge(s.deferred, b.deferred),
  };
}

// Templates mark the part a person must write as a line of bracketed text,
// e.g. "[Describe the service here.]". Returns the first one left in.
export function unfilledPlaceholder(text: string): string | null {
  return text.match(/^[ \t]*(\[[^\]\n]+\])[ \t]*$/m)?.[1] ?? null;
}

export function referencedVariables(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

// The copy kept in history: send-time values are shown as a neutral label,
// never the real (secret) value.
export function redactSendTime(text: string): string {
  return text.replace(PLACEHOLDER, (match, key: string) => (SEND_TIME_KEYS.has(key) ? "[secure link — created when sent]" : match));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Plain-text body → minimal, safe HTML: everything escaped, paragraphs from
// blank lines, http(s) links made clickable. No template can inject markup.
export function textToHtml(text: string): string {
  const paragraphs = text.split(/\n{2,}/).map((p) => {
    const escaped = escapeHtml(p).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
    return `<p style="margin:0 0 14px">${escaped.replace(/\n/g, "<br>")}</p>`;
  });
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">${paragraphs.join("")}</div>`;
}

export interface EmailBrand {
  companyName: string;
  brandColor: string; // "#rrggbb", already validated
  logoUrl: string | null; // absolute
  logoWidth?: number;
  logoHeight?: number;
  phone: string | null;
  website: string | null;
  mailingAddress: string | null;
}

// The HTML version of an email with the company's header (logo, or the
// name in the brand color — many mail apps hide images until allowed, so
// the name is always there as text too) and a contact footer. Everything
// is escaped; the plain-text version is unchanged.
export function brandedEmailHtml(text: string, brand: EmailBrand): string {
  const name = escapeHtml(brand.companyName);
  const color = /^#[0-9a-f]{6}$/i.test(brand.brandColor) ? brand.brandColor : "#1f7a5a";
  const height = 40;
  const width = brand.logoWidth && brand.logoHeight ? Math.min(240, Math.round((brand.logoWidth / brand.logoHeight) * height)) : undefined;
  const header = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" height="${height}"${width ? ` width="${width}"` : ""} style="display:block;height:${height}px;${width ? `width:${width}px;` : ""}border:0">`
    : `<span style="font-size:18px;font-weight:700;color:${color}">${name}</span>`;
  const contact = [brand.phone, brand.website?.replace(/^https?:\/\//, "").replace(/\/$/, "")].filter(Boolean).map((v) => escapeHtml(v!)).join(" · ");
  const footer = [`<strong style="color:#334155">${name}</strong>`, contact, brand.mailingAddress ? escapeHtml(brand.mailingAddress) : ""].filter(Boolean).join("<br>");
  return (
    `<div style="max-width:600px;margin:0 auto">` +
    `<div style="padding:0 0 16px;margin:0 0 20px;border-bottom:3px solid ${color}">${header}</div>` +
    textToHtml(text) +
    `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#64748b">${footer}</div>` +
    `</div>`
  );
}
