import { describe, it, expect } from "vitest";
import { groupPipeline, isSettableLeadStatus, leadMoves } from "./pipeline";

describe("lead pipeline", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  it("groups leads by their own status, dropping long-closed ones", () => {
    const groups = groupPipeline(
      [
        { id: "a", status: "NEW", updatedAt: daysAgo(90) },
        { id: "b", status: "CONTACTED", updatedAt: daysAgo(1) },
        { id: "c", status: "LOST", updatedAt: daysAgo(5) },
        { id: "d", status: "LOST", updatedAt: daysAgo(45) },
        { id: "e", status: "CONVERTED", updatedAt: daysAgo(31) },
      ] as const,
      now
    );
    expect(groups.NEW.map((l) => l.id)).toEqual(["a"]); // open leads never age out
    expect(groups.CONTACTED.map((l) => l.id)).toEqual(["b"]);
    expect(groups.LOST.map((l) => l.id)).toEqual(["c"]);
    expect(groups.CONVERTED).toEqual([]);
  });

  it("offers only the moves that fit the stage, never Converted", () => {
    expect(leadMoves("NEW")).toEqual(["CONTACTED", "LOST"]);
    expect(leadMoves("QUALIFIED")).toEqual(["LOST"]);
    expect(leadMoves("LOST")).toEqual(["NEW"]);
    expect(leadMoves("CONVERTED")).toEqual([]);
    expect(isSettableLeadStatus("CONVERTED")).toBe(false);
    expect(isSettableLeadStatus("QUALIFIED")).toBe(true);
    expect(isSettableLeadStatus("qualified")).toBe(false);
  });
});
