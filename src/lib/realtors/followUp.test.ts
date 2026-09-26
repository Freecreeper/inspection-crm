import { describe, it, expect } from "vitest";
import { bucketsForFilter, followUpBucket, groupFollowUps, parseFollowUpFilter } from "./followUp";

const NOW = new Date("2026-09-26T15:00:00");
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe("followUpBucket", () => {
  it("buckets by calendar day relative to today", () => {
    expect(followUpBucket(at(2026, 9, 25), NOW)).toBe("overdue");
    expect(followUpBucket(at(2026, 9, 26, 0), NOW)).toBe("today");
    expect(followUpBucket(at(2026, 9, 26, 23), NOW)).toBe("today");
    expect(followUpBucket(at(2026, 9, 27), NOW)).toBe("thisWeek");
    expect(followUpBucket(at(2026, 10, 3), NOW)).toBe("thisWeek");
    expect(followUpBucket(at(2026, 10, 4), NOW)).toBe("upcoming");
    expect(followUpBucket(null, NOW)).toBe("unscheduled");
  });

  it("treats something due earlier today as today, not overdue", () => {
    expect(followUpBucket(at(2026, 9, 26, 8), NOW)).toBe("today");
  });
});

describe("groupFollowUps", () => {
  it("groups existing tasks without dropping any", () => {
    const tasks = [
      { id: "a", dueAt: at(2026, 9, 1) },
      { id: "b", dueAt: at(2026, 9, 26) },
      { id: "c", dueAt: at(2026, 12, 1) },
      { id: "d", dueAt: null },
    ];
    const groups = groupFollowUps(tasks, NOW);
    expect(groups.overdue.map((t) => t.id)).toEqual(["a"]);
    expect(groups.today.map((t) => t.id)).toEqual(["b"]);
    expect(groups.upcoming.map((t) => t.id)).toEqual(["c"]);
    expect(groups.unscheduled.map((t) => t.id)).toEqual(["d"]);
  });
});

describe("filters", () => {
  it("parses only known filters", () => {
    expect(parseFollowUpFilter("overdue")).toBe("overdue");
    expect(parseFollowUpFilter("bogus")).toBe("all");
    expect(parseFollowUpFilter(undefined)).toBe("all");
  });

  it("'this week' includes anything already due", () => {
    expect(bucketsForFilter("week")).toEqual(["overdue", "today", "thisWeek"]);
    expect(bucketsForFilter("none")).toEqual([]);
  });
});
