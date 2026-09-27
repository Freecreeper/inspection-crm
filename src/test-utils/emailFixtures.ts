import { vi } from "vitest";
import { Prisma } from "@prisma/client";
import { DEFAULT_TEMPLATES } from "@/lib/email/defaults";
import { AUTOMATIONS } from "@/lib/email/automations/registry";

type Fn = ReturnType<typeof vi.fn>;
export type MockDb = Record<string, Record<string, Fn>> & { $transaction: Fn; $queryRaw: Fn };

export const DEFAULT_SETTINGS = {
  id: "default",
  companyName: "Acme Inspections",
  fromName: "Acme",
  fromEmail: "hello@acme.test",
  replyTo: null,
  signature: "The Acme Team",
  companyPhone: "(828) 555-0100",
  companyWebsite: null,
  mailingAddress: "1 Main St, Hickory NC",
  inspectionPrepInstructions: null,
  marketingRequiresOptIn: true,
  campaignSendsPerMinute: 60,
  updatedById: null,
  updatedAt: new Date("2026-01-01"),
};

export const TEMPLATES = DEFAULT_TEMPLATES.map((t, i) => ({
  ...t,
  id: `tpl-${t.key}`,
  active: true,
  isSystem: true,
  createdById: null,
  updatedById: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  order: i,
}));

// A small in-memory stand-in for the email_messages table: create()
// enforces the idempotency key's uniqueness the way Postgres does, so tests
// can prove "exactly once" rather than just "create was called".
export function installEmailStore(db: MockDb) {
  const rows = new Map<string, Record<string, unknown>>();
  let seq = 0;
  db.emailMessage.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const key = data.idempotencyKey as string | null;
    if (key && [...rows.values()].some((r) => r.idempotencyKey === key)) {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    }
    const row = { id: `msg-${++seq}`, attempts: 0, simulated: false, ...data };
    rows.set(row.id, row);
    return row;
  });
  db.emailMessage.findUnique.mockImplementation(async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
    if (where.id) return rows.get(where.id) ?? null;
    if (where.idempotencyKey) return [...rows.values()].find((r) => r.idempotencyKey === where.idempotencyKey) ?? null;
    return null;
  });
  db.emailMessage.updateMany.mockResolvedValue({ count: 0 });
  return rows;
}

export function primeEmailDb(db: MockDb, opts: { automations?: Partial<Record<keyof typeof AUTOMATIONS, { active?: boolean; sendMode?: string; actions?: unknown }>> } = {}) {
  db.emailSettings.findUnique.mockResolvedValue(DEFAULT_SETTINGS);
  db.emailSettings.upsert.mockResolvedValue(DEFAULT_SETTINGS);
  db.emailSuppression.findMany.mockResolvedValue([]);
  db.emailTemplate.findUnique.mockImplementation(async ({ where }: { where: { id?: string; key?: string } }) =>
    TEMPLATES.find((t) => t.id === where.id || t.key === where.key) ?? null
  );
  db.automation.findUnique.mockImplementation(async ({ where }: { where: { key: keyof typeof AUTOMATIONS } }) => {
    const def = AUTOMATIONS[where.key];
    const override = opts.automations?.[where.key] ?? {};
    return {
      id: `auto-${where.key}`,
      key: where.key,
      name: def.name,
      active: override.active ?? def.defaultActive,
      sendMode: override.sendMode ?? def.defaultMode,
      actions: override.actions ?? {},
      createdAt: new Date("2026-01-01"),
    };
  });
  db.automationEvent.create.mockResolvedValue({});
  db.activityLog.create.mockResolvedValue({});
  return installEmailStore(db);
}
