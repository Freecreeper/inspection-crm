import { describe, it, expect } from "vitest";
import { inspectionQueue, type WorkflowInspection } from "./workflow";

const now = new Date("2026-10-29T16:00:00Z");
const bounds = { now, dayStart: new Date("2026-10-29T04:00:00Z"), dayEnd: new Date("2026-10-30T04:00:00Z") };
const at = (iso: string | null, status: WorkflowInspection["status"] = "SCHEDULED", report: WorkflowInspection["report"] = null): WorkflowInspection => ({
  status,
  scheduledAt: iso ? new Date(iso) : null,
  report,
});

describe("inspection workflow queues", () => {
  it("places scheduled inspections by their date in the business day", () => {
    expect(inspectionQueue(at("2026-10-29T13:00:00Z"), bounds)).toBe("today");
    expect(inspectionQueue(at("2026-10-30T13:00:00Z"), bounds)).toBe("upcoming");
    expect(inspectionQueue(at("2026-10-28T13:00:00Z"), bounds)).toBe("awaiting");
    expect(inspectionQueue(at(null), bounds)).toBe("awaiting");
  });

  it("goes by the inspection's status first, whatever its report says", () => {
    expect(inspectionQueue(at("2026-10-29T13:00:00Z", "IN_PROGRESS", { status: "IN_PROGRESS", deliveredAt: null }), bounds)).toBe("inProgress");
    expect(inspectionQueue(at("2026-10-29T13:00:00Z", "SCHEDULED", { status: "DRAFT", deliveredAt: null }), bounds)).toBe("today");
    expect(inspectionQueue(at("2026-10-29T13:00:00Z", "CANCELLED"), bounds)).toBeNull();
  });

  it("follows the report once the inspection is complete", () => {
    const done = (status: NonNullable<WorkflowInspection["report"]>["status"] | null, deliveredAt: string | null = null) =>
      inspectionQueue(at("2026-10-20T13:00:00Z", "COMPLETED", status ? { status, deliveredAt: deliveredAt ? new Date(deliveredAt) : null } : null), bounds);
    expect(done(null)).toBe("complete");
    expect(done("DRAFT")).toBe("reportInProgress");
    expect(done("IN_PROGRESS")).toBe("reportInProgress");
    expect(done("REVIEW_REQUIRED")).toBe("readyForReview");
    expect(done("READY_FOR_REVIEW")).toBe("readyForReview");
    expect(done("FINALIZED")).toBe("readyToDeliver");
    expect(done("AMENDED")).toBe("readyToDeliver");
    expect(done("DELIVERED", "2026-10-25T12:00:00Z")).toBe("delivered");
    expect(done("DELIVERED", "2026-10-01T12:00:00Z")).toBeNull();
    expect(done("ARCHIVED")).toBeNull();
  });
});
