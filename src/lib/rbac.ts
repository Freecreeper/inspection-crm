import type { Role } from "@prisma/client";

// The permission matrix behind §14 — checked at the API layer, not just hidden
// in the UI. Kept as one flat table so "who can void an invoice" has one
// place to look, and one place to change when the business owner corrects it.
export const PERMISSIONS = {
  "report:finalize": ["OWNER_ADMIN", "INSPECTOR"],
  "report:amend": ["OWNER_ADMIN", "INSPECTOR"],
  "report:deliver": ["OWNER_ADMIN", "INSPECTOR", "OFFICE_STAFF"],
  "invoice:void": ["OWNER_ADMIN", "OFFICE_STAFF"],
  "invoice:create": ["OWNER_ADMIN", "OFFICE_STAFF"],
  "custom-field:manage": ["OWNER_ADMIN"],
  "automation:manage": ["OWNER_ADMIN"],
  "report-builder:use": ["OWNER_ADMIN", "OFFICE_STAFF", "REPORTING_ANALYST"],
  "crm:write": ["OWNER_ADMIN", "OFFICE_STAFF"],
  // Revenue figures on relationship screens (Realtor associated/referral
  // revenue, per-transaction revenue). Every staff role, per the business
  // owner — kept as its own key so narrowing it later is a one-line change.
  "financial:read": ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR", "REPORTING_ANALYST"],
  // Email & communication (V1). Viewing history is broad; sending, editing
  // copy, and changing automation or preference state are not. Approving a
  // campaign is what authorizes it to send, so it's owner-only.
  "email:view": ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR", "REPORTING_ANALYST"],
  "email:send": ["OWNER_ADMIN", "OFFICE_STAFF"],
  "email:template_manage": ["OWNER_ADMIN"],
  "email:automation_manage": ["OWNER_ADMIN"],
  "email:campaign_create": ["OWNER_ADMIN", "OFFICE_STAFF"],
  "email:campaign_approve": ["OWNER_ADMIN"],
  "email:preferences_manage": ["OWNER_ADMIN", "OFFICE_STAFF"],
  "inspection:conduct": ["OWNER_ADMIN", "INSPECTOR"],
  // Calendar & scheduling (V1). Everyone can see the schedule; putting an
  // inspection on it or moving one is an office job. Inspectors keep the
  // ability to cancel (they could already, via the status control), and may
  // block their own time — enforced per-user in the block-time action.
  "calendar:view": ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR", "REPORTING_ANALYST"],
  "inspection:schedule": ["OWNER_ADMIN", "OFFICE_STAFF"],
  "inspection:reschedule": ["OWNER_ADMIN", "OFFICE_STAFF"],
  "inspection:cancel": ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR"],
  "calendar:block_time": ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR"],
  "task:update": ["OWNER_ADMIN", "OFFICE_STAFF"],
  // Dashboard (V1). Every staff role gets a Dashboard; what's on it is
  // decided per widget and per KPI by the permissions above (financial
  // figures by financial:read, email health by email:view, …) — so
  // narrowing one of those narrows the Dashboard with it. Customization
  // never grants access.
  "dashboard:view": ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR", "REPORTING_ANALYST"],
  // The cross-system Recent Activity feed (audit log, deliveries, sent mail).
  "activity:view": ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR", "REPORTING_ANALYST"],
  // Global record search in the Dashboard header.
  "search:global": ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR", "REPORTING_ANALYST"],
  // Broad staff access for V1 (PR #1 review item 7) — deliberately centralized
  // here rather than a bare "is there a session" check in the download route,
  // so a future per-transaction assignment restriction is a one-line change
  // in this table instead of a hunt through route handlers.
  "document:read": ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR", "REPORTING_ANALYST"],
  // Same rationale, for inspection/finding photos (Pillar 3). Kept as its own
  // key rather than reusing document:read since the two resources are
  // unrelated — a future restriction on one shouldn't accidentally apply to
  // the other.
  "media:read": ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR", "REPORTING_ANALYST"],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Role lacks permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: Role | undefined | null, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}
