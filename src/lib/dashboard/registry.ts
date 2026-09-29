// Pure (client-safe). The Dashboard's controlled catalog: which widgets and
// KPIs exist, who may see each one, and which few options each accepts.
// Preferences can only ever pick from this list — the browser can't invent
// a widget, a KPI, a filter, or a timeframe — and every entry names the
// permissions it needs, so customization can never grant access.

import type { Role } from "@prisma/client";
import { can, type Permission } from "@/lib/rbac";

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

export const WIDGET_KEYS = [
  "today",
  "needsAttention",
  "snapshot",
  "upcoming",
  "recentActivity",
  "myTasks",
  "reportsPending",
  "outstandingInvoices",
  "realtorFollowUps",
  "leadActivity",
] as const;
export type WidgetKey = (typeof WIDGET_KEYS)[number];

export type Scope = "mine" | "all";
export const TIMEFRAMES = ["week", "month", "next7", "next14"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  week: "This week",
  month: "This month",
  next7: "Next 7 days",
  next14: "Next 14 days",
};

export interface WidgetDef {
  key: WidgetKey;
  label: string;
  description: string;
  // Every listed permission is required.
  permissions: Permission[];
  // "full" widgets take the whole row; consecutive "half" widgets pair up
  // on wide screens. Phones always stack in the user's order.
  span: "full" | "half";
  // Approved "My … / All …" filter, if the widget has one.
  scope?: { mine: string; all: string };
  timeframes?: readonly Timeframe[];
}

export const WIDGETS: readonly WidgetDef[] = [
  {
    key: "today",
    label: "Today",
    description: "Today's inspections, tasks, follow-ups, and report deadlines.",
    permissions: ["calendar:view"],
    span: "full",
    scope: { mine: "My inspections", all: "All inspections" },
  },
  {
    key: "needsAttention",
    label: "Needs Attention",
    description: "What could go wrong next, from fixed business rules.",
    permissions: ["dashboard:view"],
    span: "full",
    scope: { mine: "My items", all: "All items" },
  },
  {
    key: "snapshot",
    label: "Business Snapshot",
    description: "A few key numbers at a glance.",
    permissions: ["dashboard:view"],
    span: "full",
  },
  {
    key: "upcoming",
    label: "Upcoming",
    description: "Inspections per day after today.",
    permissions: ["calendar:view"],
    span: "half",
    scope: { mine: "My schedule", all: "All inspectors" },
    timeframes: ["next7", "next14"],
  },
  {
    key: "recentActivity",
    label: "Recent Activity",
    description: "What just happened across the CRM.",
    permissions: ["activity:view"],
    span: "half",
  },
  {
    key: "myTasks",
    label: "Tasks",
    description: "Open tasks due soon, with a quick complete.",
    permissions: ["dashboard:view"],
    span: "half",
    scope: { mine: "My tasks", all: "All tasks" },
  },
  {
    key: "reportsPending",
    label: "Reports Needing Completion",
    description: "Completed inspections whose report isn't finalized yet.",
    permissions: ["dashboard:view"],
    span: "half",
    scope: { mine: "My reports", all: "All reports" },
  },
  {
    key: "outstandingInvoices",
    label: "Outstanding Invoices",
    description: "Issued invoices with a balance due.",
    permissions: ["financial:read"],
    span: "half",
  },
  {
    key: "realtorFollowUps",
    label: "Realtor Follow-Ups",
    description: "Relationship follow-ups due this week.",
    permissions: ["dashboard:view"],
    span: "half",
    scope: { mine: "My follow-ups", all: "All follow-ups" },
  },
  {
    key: "leadActivity",
    label: "Lead Activity",
    description: "New and converted leads.",
    permissions: ["dashboard:view"],
    span: "half",
    timeframes: ["week", "month"],
  },
];

export const WIDGET_BY_KEY = Object.fromEntries(WIDGETS.map((w) => [w.key, w])) as Record<WidgetKey, WidgetDef>;

export function isWidgetKey(v: unknown): v is WidgetKey {
  return typeof v === "string" && (WIDGET_KEYS as readonly string[]).includes(v);
}

export function canUseWidget(role: Role | null | undefined, key: WidgetKey): boolean {
  return WIDGET_BY_KEY[key].permissions.every((p) => can(role, p));
}

export function availableWidgets(role: Role | null | undefined): WidgetDef[] {
  return WIDGETS.filter((w) => canUseWidget(role, w.key));
}

// ---------------------------------------------------------------------------
// Business Snapshot KPIs
// ---------------------------------------------------------------------------

export const KPI_KEYS = [
  "inspectionsMonth",
  "inspectionsWeek",
  "revenueMonth",
  "avgInspectionValue",
  "referralsMonth",
  "realtorReferralsMonth",
  "outstandingBalance",
  "unpaidInvoices",
  "reportsAwaiting",
  "unsignedAgreements",
  "newLeadsMonth",
  "overdueTasks",
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

// A snapshot, not a wall of metrics. Deeper analysis belongs in Reports.
export const KPI_LIMIT = 6;

export interface KpiDef {
  key: KpiKey;
  label: string;
  // Plain-words definition, shown as the card's description.
  definition: string;
  permissions: Permission[];
  format: "count" | "money";
  href: string;
}

export const KPIS: readonly KpiDef[] = [
  { key: "inspectionsMonth", label: "Inspections this month", definition: "Scheduled, in progress, or completed this calendar month (cancelled excluded).", permissions: ["dashboard:view"], format: "count", href: "/calendar?view=month" },
  { key: "inspectionsWeek", label: "Inspections this week", definition: "Scheduled, in progress, or completed this week (cancelled excluded).", permissions: ["dashboard:view"], format: "count", href: "/calendar?view=week" },
  { key: "revenueMonth", label: "Revenue this month", definition: "Billed revenue: line items on invoices issued this month that were sent, partly paid, paid, or overdue. Drafts and voids excluded.", permissions: ["financial:read"], format: "money", href: "/invoices?view=billed" },
  { key: "avgInspectionValue", label: "Avg inspection value", definition: "This month's billed revenue ÷ the number of those invoices (one invoice per inspection job).", permissions: ["financial:read"], format: "money", href: "/invoices?view=billed" },
  { key: "referralsMonth", label: "Referrals this month", definition: "Transactions started this month with a referral source. Being the agent on a deal is not a referral.", permissions: ["dashboard:view"], format: "count", href: "/referral-sources" },
  { key: "realtorReferralsMonth", label: "Realtor referrals this month", definition: "Transactions started this month whose referral source is a Realtor.", permissions: ["dashboard:view"], format: "count", href: "/referral-sources" },
  { key: "outstandingBalance", label: "Outstanding balance", definition: "Balance due on issued invoices (sent, partly paid, or overdue).", permissions: ["financial:read"], format: "money", href: "/invoices" },
  { key: "unpaidInvoices", label: "Unpaid invoices", definition: "Issued invoices with a balance due.", permissions: ["financial:read"], format: "count", href: "/invoices" },
  { key: "reportsAwaiting", label: "Reports awaiting completion", definition: "Completed inspections whose report isn't finalized or delivered.", permissions: ["dashboard:view"], format: "count", href: "/inspections?filter=report-pending" },
  { key: "unsignedAgreements", label: "Unsigned agreements", definition: "Scheduled inspections in the next 14 days without a signed agreement.", permissions: ["dashboard:view"], format: "count", href: "/inspections?filter=agreement-unsigned" },
  { key: "newLeadsMonth", label: "New leads this month", definition: "Leads created this calendar month.", permissions: ["dashboard:view"], format: "count", href: "/leads" },
  { key: "overdueTasks", label: "Overdue tasks", definition: "Open tasks whose due date has passed.", permissions: ["dashboard:view"], format: "count", href: "/tasks" },
];

export const KPI_BY_KEY = Object.fromEntries(KPIS.map((k) => [k.key, k])) as Record<KpiKey, KpiDef>;

export function isKpiKey(v: unknown): v is KpiKey {
  return typeof v === "string" && (KPI_KEYS as readonly string[]).includes(v);
}

export function canUseKpi(role: Role | null | undefined, key: KpiKey): boolean {
  return KPI_BY_KEY[key].permissions.every((p) => can(role, p));
}

export function availableKpis(role: Role | null | undefined): KpiDef[] {
  return KPIS.filter((k) => canUseKpi(role, k.key));
}

// ---------------------------------------------------------------------------
// Needs Attention categories
// ---------------------------------------------------------------------------

// Required categories can't be hidden: hiding them would risk a missed
// inspection, an undelivered report, a lost email, or unpaid work.
export const REQUIRED_ATTENTION = [
  { key: "conflict", label: "Scheduling conflicts" },
  { key: "deliveryFailed", label: "Failed report deliveries" },
  { key: "emailFailed", label: "Failed operational emails" },
  { key: "noInspector", label: "Inspections without an inspector" },
  { key: "agreementUnsigned", label: "Unsigned agreements" },
  { key: "reportUnfinished", label: "Reports not finalized" },
  { key: "invoiceOverdue", label: "Overdue invoices" },
] as const;

export const OPTIONAL_ATTENTION = [
  { key: "taskOverdue", label: "Overdue tasks" },
  { key: "realtorFollowUp", label: "Realtor follow-ups due" },
  { key: "emailReview", label: "Emails waiting for review" },
] as const;

export type RequiredAttentionCategory = (typeof REQUIRED_ATTENTION)[number]["key"];
export type OptionalAttentionCategory = (typeof OPTIONAL_ATTENTION)[number]["key"];
export type AttentionCategory = RequiredAttentionCategory | OptionalAttentionCategory;

export const ATTENTION_PERMISSIONS: Record<AttentionCategory, Permission[]> = {
  conflict: ["calendar:view"],
  deliveryFailed: ["dashboard:view"],
  emailFailed: ["email:view"],
  noInspector: ["calendar:view"],
  agreementUnsigned: ["calendar:view"],
  reportUnfinished: ["dashboard:view"],
  invoiceOverdue: ["financial:read"],
  taskOverdue: ["dashboard:view"],
  realtorFollowUp: ["dashboard:view"],
  emailReview: ["email:send"],
};

export function isOptionalAttention(v: unknown): v is OptionalAttentionCategory {
  return typeof v === "string" && OPTIONAL_ATTENTION.some((c) => c.key === v);
}

export function canSeeAttention(role: Role | null | undefined, category: AttentionCategory): boolean {
  return ATTENTION_PERMISSIONS[category].every((p) => can(role, p));
}

// ---------------------------------------------------------------------------
// Role defaults (before permission filtering — see preferences.ts)
// ---------------------------------------------------------------------------

export interface RoleDefault {
  visible: WidgetKey[]; // in order; everything else is hidden, after these
  kpis: KpiKey[];
  scope: Partial<Record<WidgetKey, Scope>>;
}

const OWNER_DEFAULT: RoleDefault = {
  visible: ["today", "needsAttention", "snapshot", "upcoming", "recentActivity"],
  kpis: ["inspectionsMonth", "revenueMonth", "avgInspectionValue", "referralsMonth"],
  scope: {},
};

export const ROLE_DEFAULTS: Record<Role, RoleDefault> = {
  OWNER_ADMIN: OWNER_DEFAULT,
  OFFICE_STAFF: {
    visible: ["today", "needsAttention", "snapshot", "upcoming", "myTasks", "recentActivity"],
    kpis: ["inspectionsWeek", "unsignedAgreements", "outstandingBalance", "reportsAwaiting"],
    scope: { myTasks: "all" },
  },
  INSPECTOR: {
    visible: ["today", "needsAttention", "myTasks", "reportsPending", "upcoming"],
    kpis: ["inspectionsWeek", "inspectionsMonth", "reportsAwaiting", "overdueTasks"],
    scope: { today: "mine", needsAttention: "mine", upcoming: "mine", myTasks: "mine", reportsPending: "mine", realtorFollowUps: "mine" },
  },
  REPORTING_ANALYST: OWNER_DEFAULT,
};

// When a default KPI isn't available to the role, the snapshot is topped
// up from these (in order) so it's still useful rather than half-empty.
export const KPI_FALLBACKS: KpiKey[] = ["inspectionsMonth", "inspectionsWeek", "referralsMonth", "reportsAwaiting", "newLeadsMonth", "overdueTasks"];
