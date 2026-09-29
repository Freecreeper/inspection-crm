// Pure (client-safe). What the Dashboard service hands the browser — plain,
// serializable, derived on every request from the authoritative records.

import type { CalendarEvent } from "@/lib/calendar/types";
import type { DayKey } from "@/lib/calendar/time";
import type { AttentionCategory, KpiKey, Timeframe, WidgetKey } from "./registry";

export type AttentionSeverity = "critical" | "warning" | "action" | "info";

// A derived Needs Attention entry. Never stored: when the underlying record
// changes (agreement signed, invoice paid, task completed), the next load
// simply doesn't produce it.
export interface AttentionItem {
  id: string;
  category: AttentionCategory;
  required: boolean;
  severity: AttentionSeverity;
  title: string;
  // What it's about: an address, a customer, a Realtor…
  subject: string;
  detail: string | null;
  sourceType: string;
  sourceId: string;
  dueAt: string | null; // ISO instant or YYYY-MM-DD
  overdue: boolean;
  actionLabel: string;
  href: string;
  // Opens the shared preview drawer instead of navigating, when set.
  preview: { type: "inspection" | "task"; id: string } | null;
  // For tie-breaking by recency.
  occurredAt: string | null;
}

export interface KpiValue {
  key: KpiKey;
  value: number | null; // null = nothing to measure yet (never a fake 0)
}

export interface UpcomingDay {
  day: DayKey;
  inspections: number;
  needsAttention: number;
  firstStart: string | null;
}

export interface TaskRow {
  id: string;
  title: string;
  due: DayKey | null;
  overdue: boolean;
  assigneeName: string | null;
  context: string | null; // Realtor or property
  href: string;
  realtor: { id: string; name: string; phone: string | null } | null;
}

export interface ReportRow {
  inspectionId: string;
  reportId: string | null;
  address: string;
  inspectedOn: DayKey | null;
  statusLabel: string;
  overdue: boolean;
  inspectorName: string | null;
  href: string;
}

export interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  customer: string | null;
  balance: string; // decimal string
  due: DayKey | null;
  overdue: boolean;
  href: string;
}

export interface LeadRow {
  id: string;
  name: string;
  status: string;
  source: string | null;
  createdDay: DayKey;
}

export interface ActivityEntry {
  id: string;
  label: string;
  detail: string | null;
  at: string;
  href: string | null;
  actor: string | null;
}

export type WidgetData =
  | { key: "today"; events: CalendarEvent[] }
  | { key: "needsAttention"; items: AttentionItem[] }
  | { key: "snapshot"; kpis: KpiValue[] }
  | { key: "upcoming"; days: UpcomingDay[]; total: number; timeframe: Timeframe }
  | { key: "recentActivity"; entries: ActivityEntry[] }
  | { key: "myTasks"; rows: TaskRow[]; total: number }
  | { key: "reportsPending"; rows: ReportRow[]; total: number }
  | { key: "outstandingInvoices"; rows: InvoiceRow[]; total: number; balance: string }
  | { key: "realtorFollowUps"; rows: TaskRow[]; total: number }
  | { key: "leadActivity"; timeframe: Timeframe; created: number; converted: number; recent: LeadRow[] };

// One widget failing to load shows an error in that card only.
export type WidgetResult = WidgetData | { key: WidgetKey; error: string };
