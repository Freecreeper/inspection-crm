import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(), writeFile: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { mkdir, writeFile } from "node:fs/promises";
import {
  createTransaction,
  addCustomerToTransaction,
  setPrimaryCustomer,
  addRealtorToTransaction,
  addCommunication,
  uploadDocument,
} from "./actions";

const mockAuth = vi.mocked(auth);
const mockPrisma = prisma as unknown as {
  transaction: { create: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  transactionCustomer: {
    create: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  transactionRealtor: { create: ReturnType<typeof vi.fn> };
  realtor: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  communication: { create: ReturnType<typeof vi.fn> };
  document: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { role: "OFFICE_STAFF", id: "user-1" } } as never);
});

describe("createTransaction", () => {
  it("succeeds with no fields at all (item 3: nothing is structurally required)", async () => {
    mockPrisma.transaction.create.mockResolvedValue({ id: "txn-1" });
    const form = new FormData();
    await expect(createTransaction(form)).rejects.toThrow("NEXT_REDIRECT:/transactions/txn-1");

    expect(mockPrisma.transaction.create).toHaveBeenCalledWith({
      data: { propertyId: null, referralSourceId: null, status: "LEAD_IN_PROGRESS" },
    });
    // No customer was supplied, so no TransactionCustomer row should be created.
    expect(mockPrisma.transactionCustomer.create).not.toHaveBeenCalled();
  });

  it("marks a supplied customer as the primary contact", async () => {
    mockPrisma.transaction.create.mockResolvedValue({ id: "txn-1" });
    const form = new FormData();
    form.set("customerId", "cust-1");
    await expect(createTransaction(form)).rejects.toThrow("NEXT_REDIRECT:/transactions/txn-1");

    expect(mockPrisma.transactionCustomer.create).toHaveBeenCalledWith({
      data: { transactionId: "txn-1", customerId: "cust-1", role: "PRIMARY_BUYER", primaryContact: true },
    });
  });

  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    await expect(createTransaction(new FormData())).rejects.toThrow();
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });
});

describe("addCustomerToTransaction", () => {
  it("demotes the previous primary contact when a new one is added as primary (item 1)", async () => {
    const form = new FormData();
    form.set("customerId", "cust-2");
    form.set("role", "SECONDARY_BUYER");
    form.set("primaryContact", "true");
    await addCustomerToTransaction("txn-1", form);

    expect(mockPrisma.transactionCustomer.updateMany).toHaveBeenCalledWith({
      where: { transactionId: "txn-1", primaryContact: true },
      data: { primaryContact: false },
    });
    expect(mockPrisma.transactionCustomer.create).toHaveBeenCalledWith({
      data: { transactionId: "txn-1", customerId: "cust-2", role: "SECONDARY_BUYER", primaryContact: true },
    });
  });

  it("does not touch the existing primary when the addition isn't marked primary", async () => {
    const form = new FormData();
    form.set("customerId", "cust-2");
    form.set("role", "OTHER");
    await addCustomerToTransaction("txn-1", form);

    expect(mockPrisma.transactionCustomer.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.transactionCustomer.create).toHaveBeenCalledWith({
      data: { transactionId: "txn-1", customerId: "cust-2", role: "OTHER", primaryContact: false },
    });
  });
});

describe("setPrimaryCustomer", () => {
  it("refuses to promote a row that doesn't belong to this transaction", async () => {
    mockPrisma.transactionCustomer.updateMany.mockImplementation(async ({ where }: { where: { id?: string } }) => {
      // Simulate the DB: the (id, transactionId) filter matches nothing
      // because that transactionCustomer belongs to a different transaction.
      if (where.id) return { count: 0 };
      return { count: 1 };
    });
    const form = new FormData();
    form.set("transactionCustomerId", "tc-from-another-transaction");
    await expect(setPrimaryCustomer("txn-1", form)).rejects.toThrow(/not on this transaction/i);
  });

  it("promotes a row that does belong to this transaction", async () => {
    mockPrisma.transactionCustomer.updateMany.mockResolvedValue({ count: 1 });
    const form = new FormData();
    form.set("transactionCustomerId", "tc-1");
    await setPrimaryCustomer("txn-1", form);

    expect(mockPrisma.transactionCustomer.updateMany).toHaveBeenCalledWith({
      where: { id: "tc-1", transactionId: "txn-1" },
      data: { primaryContact: true },
    });
  });
});

describe("addRealtorToTransaction", () => {
  it("snapshots the realtor's current brokerage at attach time (item 5)", async () => {
    mockPrisma.realtor.findUniqueOrThrow.mockResolvedValue({
      id: "realtor-1",
      brokerageId: "brok-1",
      brokerage: { id: "brok-1", name: "Acme Realty" },
    });
    const form = new FormData();
    form.set("realtorId", "realtor-1");
    form.set("role", "BUYER_AGENT");
    await addRealtorToTransaction("txn-1", form);

    expect(mockPrisma.transactionRealtor.create).toHaveBeenCalledWith({
      data: {
        transactionId: "txn-1",
        realtorId: "realtor-1",
        role: "BUYER_AGENT",
        brokerageId: "brok-1",
        brokerageName: "Acme Realty",
      },
    });
  });

  it("snapshots null when the realtor has no current brokerage", async () => {
    mockPrisma.realtor.findUniqueOrThrow.mockResolvedValue({ id: "realtor-1", brokerageId: null, brokerage: null });
    const form = new FormData();
    form.set("realtorId", "realtor-1");
    form.set("role", "OTHER");
    await addRealtorToTransaction("txn-1", form);

    expect(mockPrisma.transactionRealtor.create).toHaveBeenCalledWith({
      data: {
        transactionId: "txn-1",
        realtorId: "realtor-1",
        role: "OTHER",
        brokerageId: null,
        brokerageName: null,
      },
    });
  });
});

describe("addCommunication", () => {
  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    const form = new FormData();
    form.set("channel", "Phone");
    form.set("direction", "OUTBOUND");
    form.set("summary", "Left a voicemail");
    await expect(addCommunication("txn-1", form)).rejects.toThrow();
    expect(mockPrisma.communication.create).not.toHaveBeenCalled();
  });

  it("requires channel, direction, and summary", async () => {
    await expect(addCommunication("txn-1", new FormData())).rejects.toThrow(/required/i);
  });

  it("logs a communication against the transaction", async () => {
    const form = new FormData();
    form.set("channel", "Email");
    form.set("direction", "INBOUND");
    form.set("summary", "Asked about scheduling");
    await addCommunication("txn-1", form);

    expect(mockPrisma.communication.create).toHaveBeenCalledWith({
      data: { transactionId: "txn-1", channel: "Email", direction: "INBOUND", summary: "Asked about scheduling" },
    });
  });
});

describe("uploadDocument", () => {
  it("rejects when the transaction does not exist (authorization)", async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue(null);
    const form = new FormData();
    form.set("file", new File([new Uint8Array(10)], "notes.pdf", { type: "application/pdf" }));
    await expect(uploadDocument("missing-txn", form)).rejects.toThrow(/not found/i);
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("rejects a disallowed file type before touching disk", async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({ id: "txn-1" });
    const form = new FormData();
    form.set("file", new File([new Uint8Array(10)], "virus.exe", { type: "application/x-msdownload" }));
    await expect(uploadDocument("txn-1", form)).rejects.toThrow();
    expect(writeFile).not.toHaveBeenCalled();
    expect(mockPrisma.document.create).not.toHaveBeenCalled();
  });

  it("stores a valid upload and records the uploader", async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({ id: "txn-1" });
    mockPrisma.document.create.mockResolvedValue({});
    const form = new FormData();
    form.set("file", new File([new Uint8Array(10)], "inspection-notes.pdf", { type: "application/pdf" }));
    await uploadDocument("txn-1", form);

    expect(writeFile).toHaveBeenCalled();
    expect(mockPrisma.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: "txn-1",
        title: "inspection-notes.pdf",
        fileType: "application/pdf",
        uploadedById: "user-1",
      }),
    });
  });
});
