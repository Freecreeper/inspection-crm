// Business-wide Calendar settings. Deliberately few, with sensible
// defaults, overridable per deployment through the environment rather than
// a settings screen (V1). The time zone is the same APP_TIMEZONE the email
// system uses, so a reminder and the Calendar always agree on "which day".

export interface CalendarConfig {
  timeZone: string;
  // First/last hour shown on Day and Week grids (events outside still show).
  dayStartHour: number;
  dayEndHour: number;
  // 0 = Sunday … 6 = Saturday.
  weekStartsOn: number;
  // Used when none of an inspection's services has a default duration.
  defaultDurationMinutes: number;
  slotMinutes: number;
  // A report is due this many days after the inspection date.
  reportDueDays: number;
  // When true, an unpaid balance is a readiness warning before inspection.
  requirePaymentBeforeInspection: boolean;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function getCalendarConfig(): CalendarConfig {
  const dayStartHour = intEnv("CALENDAR_DAY_START_HOUR", 7, 0, 23);
  return {
    timeZone: process.env.APP_TIMEZONE?.trim() || "America/New_York",
    dayStartHour,
    dayEndHour: Math.max(dayStartHour + 1, intEnv("CALENDAR_DAY_END_HOUR", 20, 1, 24)),
    weekStartsOn: intEnv("CALENDAR_WEEK_STARTS_ON", 0, 0, 6),
    defaultDurationMinutes: intEnv("CALENDAR_DEFAULT_DURATION_MINUTES", 180, 15, 12 * 60),
    slotMinutes: 15,
    reportDueDays: intEnv("CALENDAR_REPORT_DUE_DAYS", 1, 0, 30),
    requirePaymentBeforeInspection: process.env.CALENDAR_REQUIRE_PAYMENT === "true",
  };
}

// What the browser needs to lay out grids; nothing sensitive.
export type ClientCalendarConfig = Pick<CalendarConfig, "timeZone" | "dayStartHour" | "dayEndHour" | "weekStartsOn" | "defaultDurationMinutes" | "slotMinutes">;

export function clientCalendarConfig(config = getCalendarConfig()): ClientCalendarConfig {
  const { timeZone, dayStartHour, dayEndHour, weekStartsOn, defaultDurationMinutes, slotMinutes } = config;
  return { timeZone, dayStartHour, dayEndHour, weekStartsOn, defaultDurationMinutes, slotMinutes };
}
