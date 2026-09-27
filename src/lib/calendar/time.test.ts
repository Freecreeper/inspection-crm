import { describe, it, expect } from "vitest";
import {
  addDays,
  dateOnlyKey,
  dayKeyToDateOnly,
  eachDay,
  formatDay,
  isDayKey,
  isTimeOfDay,
  minutesIntoDay,
  shiftAnchor,
  toDayKey,
  viewRange,
  zonedDateTimeToUtc,
} from "./time";

const NY = "America/New_York";

describe("business time zone conversion", () => {
  it("reads a typed date + time as New York wall time, in summer and winter", () => {
    expect(zonedDateTimeToUtc("2026-09-29", "09:00", NY).toISOString()).toBe("2026-09-29T13:00:00.000Z"); // EDT
    expect(zonedDateTimeToUtc("2026-12-15", "09:00", NY).toISOString()).toBe("2026-12-15T14:00:00.000Z"); // EST
  });

  it("is independent of the machine's own zone and round-trips", () => {
    const start = zonedDateTimeToUtc("2026-11-01", "13:30", NY);
    expect(toDayKey(start, NY)).toBe("2026-11-01");
    expect(minutesIntoDay(start, NY)).toBe(13 * 60 + 30);
  });

  it("handles the DST gap and the repeated hour deterministically", () => {
    // 2:30 AM doesn't exist on Mar 8, 2026 in New York — lands after the gap.
    expect(zonedDateTimeToUtc("2026-03-08", "02:30", NY).toISOString()).toBe("2026-03-08T07:30:00.000Z");
    // 1:30 AM happens twice on Nov 1, 2026 — the first (EDT) one is used.
    expect(zonedDateTimeToUtc("2026-11-01", "01:30", NY).toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("a late-evening appointment stays on its business day even though it's the next day in UTC", () => {
    const late = zonedDateTimeToUtc("2026-09-29", "22:00", NY);
    expect(late.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(toDayKey(late, NY)).toBe("2026-09-29");
  });
});

describe("date-only fields (closing date, inspection deadline)", () => {
  it("never shift a day: stored at UTC midnight, read back as the same calendar day", () => {
    const stored = dayKeyToDateOnly("2026-10-02");
    expect(stored.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(dateOnlyKey(stored)).toBe("2026-10-02");
    // Converting through New York would have said Oct 1 — which is exactly the bug avoided.
    expect(toDayKey(stored, NY)).toBe("2026-10-01");
    expect(formatDay("2026-10-02", "long")).toBe("Friday, October 2, 2026");
  });

  it("validates day keys and times strictly", () => {
    expect(isDayKey("2026-02-29")).toBe(false);
    expect(isDayKey("2028-02-29")).toBe(true);
    expect(isDayKey("2026-9-1")).toBe(false);
    expect(isTimeOfDay("09:15")).toBe(true);
    expect(isTimeOfDay("24:00")).toBe(false);
  });
});

describe("view ranges", () => {
  it("week starts on the configured weekday and spans 7 days", () => {
    expect(viewRange("week", "2026-09-30", 0)).toEqual({ start: "2026-09-27", end: "2026-10-04" });
    expect(viewRange("week", "2026-09-30", 1)).toEqual({ start: "2026-09-28", end: "2026-10-05" });
  });

  it("month shows whole weeks around the month; day is one day", () => {
    const month = viewRange("month", "2026-09-15", 0);
    expect(month).toEqual({ start: "2026-08-30", end: "2026-10-04" });
    expect(eachDay(month.start, month.end)).toHaveLength(35);
    expect(viewRange("day", "2026-09-30", 0)).toEqual({ start: "2026-09-30", end: "2026-10-01" });
  });

  it("the 4-month planning view covers exactly four whole months and pages by four", () => {
    expect(viewRange("4month", "2026-09-27", 0)).toEqual({ start: "2026-09-01", end: "2027-01-01" });
    expect(eachDay("2026-09-01", "2027-01-01")).toHaveLength(122);
    expect(shiftAnchor("4month", "2026-09-27", 1)).toBe("2027-01-01");
    expect(shiftAnchor("4month", "2026-09-27", -1)).toBe("2026-05-01");
  });

  it("navigates by the view's unit", () => {
    expect(shiftAnchor("week", "2026-09-30", 1)).toBe("2026-10-07");
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("saved view preference", () => {
  it("accepts the four views and falls back to week for anything else", async () => {
    const { normalizePreferences } = await import("./layers");
    expect(normalizePreferences({ view: "4month" }).view).toBe("4month");
    expect(normalizePreferences({ view: "year" }).view).toBe("week");
  });
});
