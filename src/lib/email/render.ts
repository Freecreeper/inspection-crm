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
