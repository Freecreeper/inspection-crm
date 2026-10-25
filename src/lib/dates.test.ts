import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { addDays, formatShortDate, parseDateInput, startOfDay, toDateInputValue } from "./dates";
import { formatBusinessDate, formatBusinessDateTimeWithZone } from "./businessTime";

// Production runs in UTC while the business is in New York: every helper must
// use APP_TIMEZONE, not the process zone.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
  vi.stubEnv("APP_TIMEZONE", "America/New_York");
});
afterAll(() => {
  process.env.TZ = originalTz;
  vi.unstubAllEnvs();
});

describe("business-zone date helpers (server in UTC)", () => {
  it("a typed due date is noon of that day in the business zone", () => {
    expect(parseDateInput("2026-10-03")?.toISOString()).toBe("2026-10-03T16:00:00.000Z");
    expect(parseDateInput("2026-02-30")).toBeNull();
    expect(parseDateInput("10/03/2026")).toBeNull();
  });

  it("10 PM in New York is still that day, though it's tomorrow in UTC", () => {
    const lateEvening = new Date("2026-10-04T02:00:00Z"); // Oct 3, 10 PM EDT
    expect(toDateInputValue(lateEvening)).toBe("2026-10-03");
    expect(startOfDay(lateEvening).toISOString()).toBe("2026-10-03T04:00:00.000Z");
    expect(formatBusinessDate(lateEvening)).toBe("Oct 3, 2026");
  });

  it("adding a day keeps the wall-clock time across the DST change", () => {
    // Noon EDT on Oct 31 → noon EST on Nov 1 (clocks fall back that night).
    expect(addDays(new Date("2026-10-31T16:00:00Z"), 1).toISOString()).toBe("2026-11-01T17:00:00.000Z");
    expect(addDays(new Date("2026-11-01T17:00:00Z"), -1).toISOString()).toBe("2026-10-31T16:00:00.000Z");
  });

  it("formats short dates and customer-facing timestamps in the business zone", () => {
    expect(formatShortDate(new Date("2026-10-04T02:00:00Z"))).toMatch(/^Oct 3/);
    expect(formatBusinessDateTimeWithZone(new Date("2026-10-21T18:30:00Z"))).toBe("Oct 21, 2026, 2:30 PM EDT");
  });
});
