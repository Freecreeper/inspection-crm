import { describe, it, expect } from "vitest";
import { groupTransactionStages, isAllowedTransactionMove, transactionMoves } from "./transactionStages";

describe("transaction stages", () => {
  it("moves forward one step at a time, can cancel while open, and reopens a cancelled one", () => {
    expect(transactionMoves("LEAD_IN_PROGRESS").map((m) => m.to)).toEqual(["SCHEDULED", "CANCELLED"]);
    expect(transactionMoves("COMPLETED").map((m) => m.to)).toEqual(["CLOSED", "CANCELLED"]);
    expect(transactionMoves("CANCELLED").map((m) => m.to)).toEqual(["LEAD_IN_PROGRESS"]);
    expect(transactionMoves("CLOSED")).toEqual([]);
  });

  it("rejects skipping stages, going backwards, or unknown values", () => {
    expect(isAllowedTransactionMove("LEAD_IN_PROGRESS", "SCHEDULED")).toBe(true);
    expect(isAllowedTransactionMove("LEAD_IN_PROGRESS", "COMPLETED")).toBe(false);
    expect(isAllowedTransactionMove("IN_PROGRESS", "SCHEDULED")).toBe(false);
    expect(isAllowedTransactionMove("CLOSED", "CANCELLED")).toBe(false);
    expect(isAllowedTransactionMove("SCHEDULED", "DONE")).toBe(false);
  });

  it("keeps open transactions however old, and closed or cancelled ones for 30 days", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
    const groups = groupTransactionStages(
      [
        { id: "a", status: "LEAD_IN_PROGRESS" as const, updatedAt: ago(200) },
        { id: "b", status: "CLOSED" as const, updatedAt: ago(10) },
        { id: "c", status: "CLOSED" as const, updatedAt: ago(40) },
        { id: "d", status: "CANCELLED" as const, updatedAt: ago(31) },
      ],
      now
    );
    expect(groups.LEAD_IN_PROGRESS.map((r) => r.id)).toEqual(["a"]);
    expect(groups.CLOSED.map((r) => r.id)).toEqual(["b"]);
    expect(groups.CANCELLED).toEqual([]);
  });
});
