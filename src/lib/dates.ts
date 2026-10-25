import { businessTimeZone } from "@/lib/businessTime";
import { addDays as addDayKeys, startOfDayUtc, timeOfDay, toDayKey, zonedDateTimeToUtc } from "@/lib/calendar/time";

// Calendar-day helpers for task due dates, follow-up buckets and "today" —
// all in the business time zone (APP_TIMEZONE), never the machine's. The
// production container runs in UTC and a staff browser can be anywhere, so
// using the process-local zone put tasks on the wrong day and made server
// and browser render different text (React hydration error #418).

// A date-only input ("2026-10-03") is a calendar day: anchor it at noon in
// the business zone, far from midnight so no offset can move it a day.
export function parseDateInput(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return zonedDateTimeToUtc(trimmed, "12:00", businessTimeZone());
}

// The inverse, for pre-filling an <input type="date">.
export function toDateInputValue(date: Date | null | undefined): string {
  if (!date) return "";
  return toDayKey(date, businessTimeZone());
}

// Midnight that starts this date's business day.
export function startOfDay(date: Date): Date {
  const tz = businessTimeZone();
  return startOfDayUtc(toDayKey(date, tz), tz);
}

// The same wall-clock time `days` business days later (DST-safe).
export function addDays(date: Date, days: number): Date {
  const tz = businessTimeZone();
  const day = toDayKey(date, tz);
  const time = timeOfDay(date, tz);
  const sameMinute = zonedDateTimeToUtc(day, time, tz);
  return new Date(zonedDateTimeToUtc(addDayKeys(day, days), time, tz).getTime() + (date.getTime() - sameMinute.getTime()));
}

export function formatShortDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const tz = businessTimeZone();
  const sameYear = toDayKey(d, tz).slice(0, 4) === toDayKey(new Date(), tz).slice(0, 4);
  return d.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}
