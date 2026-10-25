// Pure (client-safe). The business time zone, readable on the server and in
// the browser alike, so a date is never formatted or bucketed in whatever
// zone the machine happens to run in (the production container is UTC; a
// staff browser could be anywhere). The server reads APP_TIMEZONE; the
// browser reads the <meta name="app-timezone"> the root layout renders from
// the same value, so server and client always agree (no hydration mismatch).

export const DEFAULT_TIME_ZONE = "America/New_York";

export function businessTimeZone(): string {
  if (typeof window === "undefined") return process.env.APP_TIMEZONE?.trim() || DEFAULT_TIME_ZONE;
  return document.querySelector('meta[name="app-timezone"]')?.getAttribute("content") || DEFAULT_TIME_ZONE;
}

const toDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));

// "Oct 25, 2026"
export function formatBusinessDate(d: Date | string | number, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  return toDate(d).toLocaleDateString("en-US", { ...options, timeZone: businessTimeZone() });
}

// "Oct 25, 2026, 2:30 PM"
export function formatBusinessDateTime(d: Date | string | number, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }): string {
  return toDate(d).toLocaleString("en-US", { ...options, timeZone: businessTimeZone() });
}

// "Oct 25, 2026, 2:30 PM EDT" — for records customers keep (report PDFs).
export function formatBusinessDateTimeWithZone(d: Date | string | number): string {
  return formatBusinessDateTime(d, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}
