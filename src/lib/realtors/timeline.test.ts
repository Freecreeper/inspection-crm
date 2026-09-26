import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { communicationKind, filterTimeline, loadRealtorTimeline, mergeTimeline, parseTimelineFilter, type TimelineItem } from "./timeline";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

const item = (id: string, kind: TimelineItem["kind"], day: number): TimelineItem => ({ id, kind, at: new Date(2026, 8, day), title: id });

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of ["communication", "task", "transactionRealtor", "inspection", "transaction", "realtorBrokerageHistory", "activityLog", "document"]) {
    db[model].findMany.mockResolvedValue([]);
  }
});

describe("pure helpers", () => {
  it("merges sources newest-first and caps the result", () => {
    const merged = mergeTimeline([[item("a", "call", 1), item("b", "email", 20)], [item("c", "task", 10)]], 2);
    expect(merged.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("filters by the tab's categories", () => {
    const items = [item("call", "call", 1), item("mail", "email", 2), item("tx", "transaction", 3), item("ref", "referral", 4), item("note", "note", 5)];
    expect(filterTimeline(items, "calls").map((i) => i.id)).toEqual(["call"]);
    expect(filterTimeline(items, "transactions").map((i) => i.id)).toEqual(["tx", "ref"]);
    expect(filterTimeline(items, "notes").map((i) => i.id)).toEqual(["note"]);
    expect(filterTimeline(items, "all")).toHaveLength(5);
  });

  it("classifies communication channels", () => {
    expect(communicationKind("Phone")).toBe("call");
    expect(communicationKind("Email")).toBe("email");
    expect(communicationKind("Text")).toBe("communication");
    expect(parseTimelineFilter("junk")).toBe("all");
  });
});

describe("loadRealtorTimeline", () => {
  it("is built from real records, with every source capped", async () => {
    db.communication.findMany.mockResolvedValue([
      { id: "c1", channel: "Phone", direction: "OUTBOUND", summary: "Checked in", occurredAt: new Date(2026, 8, 14) },
    ]);
    db.transaction.findMany.mockResolvedValue([
      {
        id: "t1",
        createdAt: new Date(2026, 8, 20),
        property: null,
        customers: [{ primaryContact: true, customer: { firstName: "John", lastName: "Smith" } }],
      },
    ]);

    const items = await loadRealtorTimeline("r1", { limit: 10, includeDocuments: false });

    expect(items.map((i) => [i.kind, i.title, i.detail])).toEqual([
      ["referral", "Customer referred", "John Smith"],
      ["call", "Call logged", "Checked in"],
    ]);
    for (const model of ["communication", "task", "transactionRealtor", "inspection", "transaction", "realtorBrokerageHistory", "activityLog"]) {
      expect(db[model].findMany.mock.calls[0][0].take).toBe(10);
    }
    expect(db.document.findMany).not.toHaveBeenCalled();
  });

  it("finds referrals only through the linked referral source", async () => {
    await loadRealtorTimeline("r1", { limit: 5, includeDocuments: false });
    const referralQuery = db.transaction.findMany.mock.calls[0][0];
    expect(referralQuery.where).toEqual({ archivedAt: null, referralSource: { realtorId: "r1" } });
  });
});
