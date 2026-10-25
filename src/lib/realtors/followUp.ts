import { addDays, startOfDay } from "@/lib/dates";

export type FollowUpBucket = "overdue" | "today" | "thisWeek" | "upcoming" | "unscheduled";

export const FOLLOW_UP_BUCKET_ORDER: FollowUpBucket[] = ["overdue", "today", "thisWeek", "upcoming", "unscheduled"];

export const FOLLOW_UP_BUCKET_LABELS: Record<FollowUpBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  thisWeek: "This Week",
  upcoming: "Upcoming",
  unscheduled: "No due date",
};

export const FOLLOW_UP_FILTERS = ["all", "overdue", "today", "week", "none"] as const;
export type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number];

export function parseFollowUpFilter(raw: string | undefined): FollowUpFilter {
  return (FOLLOW_UP_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as FollowUpFilter) : "all";
}

// Calendar-day buckets relative to `now`. "This Week" is the rolling next
// seven days after today rather than the calendar week, so a Saturday
// follow-up never jumps straight from "Upcoming" to "Overdue".
export function followUpBucket(dueAt: Date | null, now: Date): FollowUpBucket {
  if (!dueAt) return "unscheduled";
  const today = startOfDay(now);
  if (dueAt < today) return "overdue";
  if (dueAt < addDays(today, 1)) return "today";
  if (dueAt < addDays(today, 8)) return "thisWeek";
  return "upcoming";
}

// The same buckets as a database condition, so each bucket is queried on
// its own (with its own limit and true count) instead of being picked out of
// one capped list — where 200 overdue tasks would hide today's.
export function bucketDueWhere(bucket: FollowUpBucket, now: Date): { dueAt: null | { gte?: Date; lt?: Date } } {
  const today = startOfDay(now);
  switch (bucket) {
    case "unscheduled":
      return { dueAt: null };
    case "overdue":
      return { dueAt: { lt: today } };
    case "today":
      return { dueAt: { gte: today, lt: addDays(today, 1) } };
    case "thisWeek":
      return { dueAt: { gte: addDays(today, 1), lt: addDays(today, 8) } };
    case "upcoming":
      return { dueAt: { gte: addDays(today, 8) } };
  }
}

export function groupFollowUps<T extends { dueAt: Date | null }>(tasks: T[], now: Date): Record<FollowUpBucket, T[]> {
  const groups: Record<FollowUpBucket, T[]> = { overdue: [], today: [], thisWeek: [], upcoming: [], unscheduled: [] };
  for (const task of tasks) groups[followUpBucket(task.dueAt, now)].push(task);
  return groups;
}

export function bucketsForFilter(filter: FollowUpFilter): FollowUpBucket[] {
  switch (filter) {
    case "overdue":
      return ["overdue"];
    case "today":
      return ["today"];
    case "week":
      return ["overdue", "today", "thisWeek"];
    case "none":
      return [];
    default:
      return FOLLOW_UP_BUCKET_ORDER;
  }
}
