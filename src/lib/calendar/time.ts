// Business-time-zone date math, shared by the server and the browser (pure:
// no Prisma, no Node APIs). The Calendar has exactly one notion of "a day":
// a calendar day in the business time zone (APP_TIMEZONE). Instants are
// stored in UTC; every grid, label, and user-entered date/time goes through
// the functions here with that zone passed explicitly, so the browser's own
// time zone and the server's never leak into scheduling.
//
// Day keys are plain "YYYY-MM-DD" strings. Date-only database fields
// (closing date, inspection deadline) are day keys too — they are never
// converted through a time zone, so they can't shift to a neighboring day.

export type DayKey = string; // "YYYY-MM-DD"

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour === 24 ? 0 : out.hour, minute: out.minute, second: out.second };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toDayKey(date: Date, timeZone: string): DayKey {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// A date-only value from the database (a @db.Date column comes back as UTC
// midnight). Read its UTC date directly — no time zone involved.
export function dateOnlyKey(date: Date | null | undefined): DayKey | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

// The inverse, for writing a day key into a @db.Date column.
export function dayKeyToDateOnly(key: DayKey): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function isDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isTimeOfDay(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

// Offset of `timeZone` from UTC at `date`, in minutes (e.g. -240 for EDT).
export function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

// "2026-09-29" + "13:00" in America/New_York → the UTC instant. Tries the
// zone's offsets on either side of the wall time and keeps the one that
// reads back as the same wall time. Around DST: an ambiguous time (the
// repeated hour in fall) takes the first occurrence; a time that doesn't
// exist (the skipped hour in spring) moves forward past the gap — the same
// rule as Temporal's "compatible" disambiguation.
export function zonedDateTimeToUtc(day: DayKey, time: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsets = [...new Set([wall - 12 * 3600_000, wall + 12 * 3600_000, wall].map((t) => timeZoneOffsetMinutes(new Date(t), timeZone)))];
  const readsBack = (instant: number) => {
    const p = zonedParts(new Date(instant), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall;
  };
  const valid = offsets.map((o) => wall - o * 60_000).filter(readsBack).sort((a, b) => a - b);
  if (valid.length) return new Date(valid[0]);
  return new Date(wall - Math.min(...offsets) * 60_000);
}

export function startOfDayUtc(day: DayKey, timeZone: string): Date {
  return zonedDateTimeToUtc(day, "00:00", timeZone);
}

export function addDays(day: DayKey, days: number): DayKey {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekday(day: DayKey): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function startOfWeek(day: DayKey, weekStartsOn: number): DayKey {
  return addDays(day, -((weekday(day) - weekStartsOn + 7) % 7));
}

export function startOfMonth(day: DayKey): DayKey {
  return `${day.slice(0, 7)}-01`;
}

export function addMonths(day: DayKey, months: number): DayKey {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}

export type CalendarView = "day" | "week" | "month" | "4month";
export const CALENDAR_VIEWS: CalendarView[] = ["day", "week", "month", "4month"];
export const VIEW_LABELS: Record<CalendarView, string> = { day: "Day", week: "Week", month: "Month", "4month": "4 Months" };

export function isCalendarView(value: unknown): value is CalendarView {
  return typeof value === "string" && (CALENDAR_VIEWS as string[]).includes(value);
}

// The day keys a view covers: [start, end). The month view shows whole
// weeks; the 4-month planning view shows exactly the four months.
export function viewRange(view: CalendarView, anchor: DayKey, weekStartsOn: number): { start: DayKey; end: DayKey } {
  if (view === "day") return { start: anchor, end: addDays(anchor, 1) };
  if (view === "4month") {
    const start = startOfMonth(anchor);
    return { start, end: addMonths(start, 4) };
  }
  if (view === "week") {
    const start = startOfWeek(anchor, weekStartsOn);
    return { start, end: addDays(start, 7) };
  }
  const first = startOfMonth(anchor);
  const start = startOfWeek(first, weekStartsOn);
  const lastOfMonth = addDays(addMonths(first, 1), -1);
  const end = addDays(startOfWeek(lastOfMonth, weekStartsOn), 7);
  return { start, end };
}

export function shiftAnchor(view: CalendarView, anchor: DayKey, direction: 1 | -1): DayKey {
  if (view === "day") return addDays(anchor, direction);
  if (view === "week") return addDays(anchor, 7 * direction);
  if (view === "4month") return addMonths(anchor, 4 * direction);
  return addMonths(anchor, direction);
}

export function eachDay(start: DayKey, end: DayKey): DayKey[] {
  const out: DayKey[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) out.push(d);
  return out;
}

// Minutes since local midnight in the business zone — where an event sits
// on a time grid.
export function minutesIntoDay(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

export function timeOfDay(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function minutesToTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function formatTime(date: Date, timeZone: string): string {
  return date.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
}

export function formatTimeRange(start: Date, end: Date, timeZone: string): string {
  return `${formatTime(start, timeZone)} – ${formatTime(end, timeZone)}`;
}

// Labels for a day key. Formatting in UTC is deliberate: a day key *is* a
// calendar day, so no zone may be applied to it.
export function formatDay(day: DayKey, style: "long" | "short" | "weekday" | "dayNumber" = "short"): string {
  const date = new Date(`${day}T12:00:00Z`);
  const options: Intl.DateTimeFormatOptions =
    style === "long"
      ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
      : style === "weekday"
        ? { weekday: "short" }
        : style === "dayNumber"
          ? { day: "numeric" }
          : { weekday: "short", month: "short", day: "numeric" };
  return date.toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

export function formatMonth(day: DayKey): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} hr`;
  return `${m} min`;
}
