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
  "inspection:conduct": ["OWNER_ADMIN", "INSPECTOR"],
  // Broad staff access for V1 (PR #1 review item 7) — deliberately centralized
  // here rather than a bare "is there a session" check in the download route,
  // so a future per-transaction assignment restriction is a one-line change
  // in this table instead of a hunt through route handlers.
  "document:read": ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR", "REPORTING_ANALYST"],
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
