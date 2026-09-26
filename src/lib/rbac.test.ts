import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { can, assertCan, ForbiddenError } from "./rbac";

// Prisma's generated Role may be a real TS enum rather than a string-literal
// union, so plain string literals aren't structurally assignable without a
// cast — this helper keeps that cast in one place instead of scattered
// through every test.
const role = (r: "OWNER_ADMIN" | "INSPECTOR" | "OFFICE_STAFF" | "REPORTING_ANALYST"): Role => r as Role;

describe("can", () => {
  it("allows a role listed for the permission", () => {
    expect(can(role("OWNER_ADMIN"), "crm:write")).toBe(true);
    expect(can(role("OFFICE_STAFF"), "crm:write")).toBe(true);
  });

  it("denies a role not listed for the permission", () => {
    expect(can(role("INSPECTOR"), "crm:write")).toBe(false);
    expect(can(role("REPORTING_ANALYST"), "crm:write")).toBe(false);
  });

  it("denies when no role is present", () => {
    expect(can(undefined, "crm:write")).toBe(false);
    expect(can(null, "crm:write")).toBe(false);
  });

  it("keeps document:read broader than crm:write on purpose", () => {
    expect(can(role("INSPECTOR"), "document:read")).toBe(true);
    expect(can(role("INSPECTOR"), "crm:write")).toBe(false);
  });

  it("lets every staff role see relationship revenue (financial:read), but not the unauthenticated", () => {
    for (const r of ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR", "REPORTING_ANALYST"] as const) expect(can(role(r), "financial:read")).toBe(true);
    expect(can(undefined, "financial:read")).toBe(false);
  });
});

describe("assertCan", () => {
  it("does not throw for an allowed role", () => {
    expect(() => assertCan(role("OWNER_ADMIN"), "crm:write")).not.toThrow();
  });

  it("throws ForbiddenError for a disallowed role", () => {
    expect(() => assertCan(role("INSPECTOR"), "crm:write")).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when unauthenticated", () => {
    expect(() => assertCan(undefined, "crm:write")).toThrow(ForbiddenError);
  });
});
