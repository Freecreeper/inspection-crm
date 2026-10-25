// Pure (client-safe): the staff roles and how they're named in the UI.
import type { Role } from "@prisma/client";

export const ROLES: Role[] = ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR", "REPORTING_ANALYST"];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER_ADMIN: "Owner / Admin",
  OFFICE_STAFF: "Office staff",
  INSPECTOR: "Inspector",
  REPORTING_ANALYST: "Reporting analyst",
};
