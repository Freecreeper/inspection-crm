// Pure (client-safe). The boards' controlled catalog: the title boards, the
// widgets that can sit on them, and each board's starting layout. A saved
// layout can only pick from this list — the browser can't invent a widget
// or an option — and every widget names the permissions it needs, so
// customizing can never grant access. Widgets show only urgent and
// immediately upcoming work: overdue, today, and a short window ahead.

import type { Role } from "@prisma/client";
import { can, type Permission } from "@/lib/rbac";

export const BOARD_IDS = ["overview", "inspections", "relationships", "clients", "communication", "tools"] as const;
export type BoardId = (typeof BOARD_IDS)[number];

export const BOARD_HREF: Record<BoardId, string> = {
  overview: "/dashboard",
  inspections: "/boards/inspections",
  relationships: "/boards/relationships",
  clients: "/boards/clients",
  communication: "/boards/communication",
  tools: "/boards/tools",
};

export const BOARD_LABELS: Record<BoardId, string> = {
  overview: "Overview",
  inspections: "Inspections",
  relationships: "Relationships",
  clients: "Clients & deals",
  communication: "Communication",
  tools: "Tools",
};

export const isBoardId = (v: unknown): v is BoardId => typeof v === "string" && (BOARD_IDS as readonly string[]).includes(v);

// Tile sizes on the 4-column grid (2 columns on phones).
export const SIZES = ["S", "M", "L", "W"] as const;
export type TileSize = (typeof SIZES)[number];
export const SIZE_LABELS: Record<TileSize, string> = { S: "Small", M: "Medium", L: "Large", W: "Wide" };

// How far ahead a tile looks. Everything overdue is always included.
export const WINDOWS = ["overdue", "today", "48h", "week"] as const;
export type TileWindow = (typeof WINDOWS)[number];
export const WINDOW_LABELS: Record<TileWindow, string> = { overdue: "Overdue only", today: "Through today", "48h": "Next 48 hours", week: "This week" };

export type Scope = "mine" | "all";

export const WIDGET_KEYS = [
  "needsAttention",
  "focusDeck",
  "nextUp",
  "timeline",
  "smartStack",
  "todaysInspections",
  "upcomingInspections",
  "schedulingIssues",
  "agreementsToSign",
  "reportsToFinish",
  "reportsToReview",
  "readyToDeliver",
  "unpaidInvoices",
  "tasksDue",
  "followUpsDue",
  "idleRealtors",
  "newReferrals",
  "newLeads",
  "stuckLeads",
  "dealDeadlines",
  "customerFollowUps",
  "emailsToReview",
  "failedEmails",
  "scheduledSends",
  "tempPasswords",
] as const;
export type WidgetKey = (typeof WIDGET_KEYS)[number];
export const isWidgetKey = (v: unknown): v is WidgetKey => typeof v === "string" && (WIDGET_KEYS as readonly string[]).includes(v);

export interface WidgetDef {
  key: WidgetKey;
  label: string;
  description: string;
  // The board it's suggested on first in the gallery.
  home: BoardId;
  // Every listed permission is required.
  permissions: Permission[];
  sizes: readonly TileSize[];
  defaultSize: TileSize;
  // Whether it can be narrowed to "my" items (assigned to me / I'm the inspector).
  scoped: boolean;
  // Whether the time window applies (some widgets have no due dates).
  windowed: boolean;
  defaultWindow: TileWindow;
  // Where "View all" goes.
  href: string;
  icon: string;
}

const ALL_SIZES = SIZES;
const def = (d: Omit<WidgetDef, "sizes" | "scoped" | "windowed" | "defaultWindow" | "defaultSize"> & Partial<WidgetDef>): WidgetDef => ({
  sizes: ALL_SIZES,
  defaultSize: "M",
  scoped: false,
  windowed: true,
  defaultWindow: "48h",
  ...d,
});

export const WIDGETS: readonly WidgetDef[] = [
  def({ key: "needsAttention", label: "Needs attention", description: "Everything urgent across the business, most pressing first.", home: "overview", permissions: ["dashboard:view"], scoped: true, windowed: false, defaultSize: "L", href: "/dashboard", icon: "alert" }),
  def({ key: "focusDeck", label: "Focus deck", description: "One urgent item at a time — act on it and the next slides up.", home: "overview", permissions: ["dashboard:view"], sizes: ["L", "W"], defaultSize: "L", scoped: true, windowed: false, href: "/dashboard", icon: "layers" }),
  def({ key: "nextUp", label: "Next up", description: "The next inspection or task due, with a countdown.", home: "overview", permissions: ["dashboard:view"], sizes: ["S", "M"], defaultSize: "M", scoped: true, windowed: false, href: "/calendar", icon: "clock" }),
  def({ key: "timeline", label: "Today timeline", description: "Today as a strip with a live now line; late items pinned above.", home: "overview", permissions: ["dashboard:view", "calendar:view"], sizes: ["L", "W"], defaultSize: "W", scoped: true, windowed: false, href: "/calendar?view=day", icon: "timeline" }),
  def({ key: "smartStack", label: "Smart stack", description: "Several widgets in one spot; it shows whichever is most urgent.", home: "overview", permissions: ["dashboard:view"], sizes: ["S", "M", "L"], defaultSize: "M", windowed: false, href: "/dashboard", icon: "stack" }),

  def({ key: "todaysInspections", label: "Today's inspections", description: "Inspections on today's schedule.", home: "inspections", permissions: ["calendar:view"], scoped: true, windowed: false, href: "/calendar?view=day", icon: "map-pin" }),
  def({ key: "upcomingInspections", label: "Coming up", description: "Inspections in the next day or two.", home: "inspections", permissions: ["calendar:view"], scoped: true, href: "/inspections", icon: "calendar" }),
  def({ key: "schedulingIssues", label: "Scheduling issues", description: "Conflicts and inspections with no inspector.", home: "inspections", permissions: ["calendar:view"], scoped: true, defaultWindow: "week", href: "/calendar", icon: "alert" }),
  def({ key: "agreementsToSign", label: "Agreements to sign", description: "Upcoming inspections without a signed agreement.", home: "inspections", permissions: ["calendar:view"], scoped: true, defaultWindow: "week", href: "/inspections?filter=agreement-unsigned", icon: "signature" }),
  def({ key: "reportsToFinish", label: "Reports to finish", description: "Completed inspections whose report isn't finalized.", home: "inspections", permissions: ["dashboard:view"], scoped: true, defaultWindow: "week", href: "/inspections?filter=report-pending", icon: "file" }),
  def({ key: "reportsToReview", label: "Reports to review", description: "Reports waiting on a review before they can be finalized.", home: "inspections", permissions: ["dashboard:view"], scoped: true, windowed: false, href: "/inspections?view=workflow", icon: "file-check" }),
  def({ key: "readyToDeliver", label: "Ready to deliver", description: "Finalized reports not delivered yet, and failed deliveries.", home: "inspections", permissions: ["dashboard:view"], scoped: true, windowed: false, href: "/inspections?view=workflow", icon: "send" }),
  def({ key: "unpaidInvoices", label: "Unpaid invoices", description: "Invoices overdue or coming due.", home: "inspections", permissions: ["financial:read"], href: "/invoices", icon: "receipt" }),

  def({ key: "tasksDue", label: "Tasks due", description: "Open tasks that are overdue or coming due.", home: "relationships", permissions: ["dashboard:view"], scoped: true, href: "/tasks", icon: "check" }),
  def({ key: "followUpsDue", label: "Realtor follow-ups", description: "Realtor follow-ups overdue or coming due.", home: "relationships", permissions: ["dashboard:view"], scoped: true, href: "/realtors?view=followup", icon: "contact" }),
  def({ key: "idleRealtors", label: "No next action", description: "Realtors with no open follow-up.", home: "relationships", permissions: ["dashboard:view"], windowed: false, href: "/realtors?view=followup&filter=none", icon: "user-x" }),
  def({ key: "newReferrals", label: "New referrals", description: "Transactions referred in the last 48 hours.", home: "relationships", permissions: ["dashboard:view"], windowed: false, href: "/referral-sources", icon: "star" }),

  def({ key: "newLeads", label: "New leads", description: "Leads not contacted yet; red once they've waited a day.", home: "clients", permissions: ["dashboard:view"], windowed: false, href: "/leads?view=pipeline", icon: "user-plus" }),
  def({ key: "stuckLeads", label: "Stalled leads", description: "Contacted or qualified leads untouched for a week.", home: "clients", permissions: ["dashboard:view"], windowed: false, href: "/leads?view=pipeline", icon: "hourglass" }),
  def({ key: "dealDeadlines", label: "Deal deadlines", description: "Inspection deadlines and closings coming up.", home: "clients", permissions: ["dashboard:view"], defaultWindow: "week", href: "/transactions?view=workflow", icon: "flag" }),
  def({ key: "customerFollowUps", label: "Customer follow-ups", description: "Open tasks on customers' transactions.", home: "clients", permissions: ["dashboard:view"], scoped: true, href: "/customers?view=followup", icon: "users" }),

  def({ key: "emailsToReview", label: "Emails to review", description: "Automation emails waiting for someone to review and send.", home: "communication", permissions: ["email:view"], windowed: false, href: "/email/review", icon: "mail" }),
  def({ key: "failedEmails", label: "Failed emails", description: "Emails that failed or bounced in the last 14 days.", home: "communication", permissions: ["email:view"], windowed: false, href: "/email", icon: "mail-x" }),
  def({ key: "scheduledSends", label: "Scheduled sends", description: "Emails set to go out soon.", home: "communication", permissions: ["email:view"], href: "/email", icon: "send" }),

  def({ key: "tempPasswords", label: "Temporary passwords", description: "Users who still need to set their own password.", home: "tools", permissions: ["user:manage"], windowed: false, href: "/settings/users", icon: "key" }),
];

const BY_KEY = new Map(WIDGETS.map((w) => [w.key, w]));
export function widgetDef(key: WidgetKey): WidgetDef {
  return BY_KEY.get(key)!;
}

export function canUseWidget(role: Role | null | undefined, key: WidgetKey): boolean {
  return BY_KEY.get(key)?.permissions.every((p) => can(role, p)) ?? false;
}

export function availableWidgets(role: Role | null | undefined): WidgetDef[] {
  return WIDGETS.filter((w) => canUseWidget(role, w.key));
}

// A tile in a starting layout (style and options default).
export interface PresetTile {
  widget: WidgetKey;
  size: TileSize;
  stack?: WidgetKey[];
}

// Each board's starting layout, before the user customizes it. Widgets the
// role can't use are dropped when it's applied.
export const BOARD_PRESETS: Record<BoardId, PresetTile[]> = {
  overview: [
    { widget: "focusDeck", size: "L" },
    { widget: "nextUp", size: "M" },
    { widget: "smartStack", size: "M", stack: ["reportsToFinish", "unpaidInvoices", "emailsToReview"] },
    { widget: "timeline", size: "W" },
    { widget: "tasksDue", size: "M" },
    { widget: "followUpsDue", size: "M" },
  ],
  inspections: [
    { widget: "todaysInspections", size: "L" },
    { widget: "nextUp", size: "M" },
    { widget: "reportsToFinish", size: "M" },
    { widget: "agreementsToSign", size: "S" },
    { widget: "schedulingIssues", size: "S" },
    { widget: "readyToDeliver", size: "M" },
    { widget: "upcomingInspections", size: "W" },
    { widget: "unpaidInvoices", size: "M" },
    { widget: "reportsToReview", size: "M" },
  ],
  relationships: [
    { widget: "followUpsDue", size: "L" },
    { widget: "tasksDue", size: "M" },
    { widget: "idleRealtors", size: "M" },
    { widget: "newReferrals", size: "W" },
  ],
  clients: [
    { widget: "newLeads", size: "L" },
    { widget: "dealDeadlines", size: "M" },
    { widget: "stuckLeads", size: "M" },
    { widget: "customerFollowUps", size: "W" },
  ],
  communication: [
    { widget: "failedEmails", size: "M" },
    { widget: "emailsToReview", size: "M" },
    { widget: "scheduledSends", size: "W" },
  ],
  tools: [{ widget: "tempPasswords", size: "M" }],
};

// One-tap starting points for any board, beyond its own preset.
export const LAYOUT_PRESETS = [
  {
    id: "inspector-morning",
    label: "Inspector's morning",
    description: "Today's route, next stop, and reports to finish.",
    tiles: [
      { widget: "nextUp", size: "M" },
      { widget: "todaysInspections", size: "L" },
      { widget: "agreementsToSign", size: "S" },
      { widget: "reportsToFinish", size: "M" },
      { widget: "timeline", size: "W" },
    ],
  },
  {
    id: "office-manager",
    label: "Office manager",
    description: "Scheduling problems, money, email and follow-ups.",
    tiles: [
      { widget: "needsAttention", size: "L" },
      { widget: "schedulingIssues", size: "S" },
      { widget: "unpaidInvoices", size: "S" },
      { widget: "emailsToReview", size: "M" },
      { widget: "newLeads", size: "M" },
      { widget: "tasksDue", size: "M" },
      { widget: "dealDeadlines", size: "M" },
    ],
  },
  {
    id: "relationship-day",
    label: "Relationship day",
    description: "Follow-ups, idle realtors, and new referrals.",
    tiles: [
      { widget: "followUpsDue", size: "L" },
      { widget: "idleRealtors", size: "M" },
      { widget: "newReferrals", size: "M" },
      { widget: "customerFollowUps", size: "W" },
    ],
  },
  {
    id: "now-next-later",
    label: "Now / next / later",
    description: "Overdue, today, and the next 48 hours as three columns of tiles.",
    tiles: [
      { widget: "focusDeck", size: "L" },
      { widget: "todaysInspections", size: "M" },
      { widget: "upcomingInspections", size: "M" },
      { widget: "tasksDue", size: "M" },
      { widget: "dealDeadlines", size: "M" },
    ],
  },
] as const satisfies readonly { id: string; label: string; description: string; tiles: readonly PresetTile[] }[];
export type LayoutPresetId = (typeof LAYOUT_PRESETS)[number]["id"];
