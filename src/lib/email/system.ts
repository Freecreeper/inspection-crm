import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureDefaultTemplates } from "./defaults";
import { AUTOMATION_KEYS, ensureAutomationRow } from "./automations/registry";
import { sweepInspectionEmails } from "./automations/inspection";
import { sweepInvoiceReminders } from "./automations/invoice";
import { sweepRealtorAnniversaries, sweepRealtorBirthdays } from "./automations/relationship";
import { materializeCampaign } from "./campaigns";
import { getEmailProvider, type EmailProvider } from "./providers";
import { promoteScheduled, recoverInterruptedSends, sendDueEmails } from "./worker";

let ensured: Promise<void> | null = null;

// Default templates, settings row, and one Automation row per registered
// automation. Idempotent and create-only; runs once per process.
export function ensureEmailSystem(db: PrismaClient = prisma): Promise<void> {
  ensured ??= (async () => {
    await ensureDefaultTemplates(db);
    for (const key of AUTOMATION_KEYS) await ensureAutomationRow(key, db);
  })().catch((err) => {
    ensured = null;
    throw err;
  });
  return ensured;
}

// Time-based automations are cheap and idempotent, but there's no reason
// to run them every few seconds.
const SWEEP_INTERVAL_MS = 10 * 60_000;
let lastSweepAt = 0;

async function runCampaigns(db: PrismaClient, now: Date) {
  const due = await db.emailCampaign.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: now } } });
  for (const campaign of due) {
    // Claim it (SCHEDULED → RUNNING) before creating messages, so two
    // workers can't both materialize the same campaign.
    const { count } = await db.emailCampaign.updateMany({
      where: { id: campaign.id, status: "SCHEDULED" },
      data: { status: "RUNNING", startedAt: now },
    });
    if (count === 1) await materializeCampaign(campaign, { now, db });
  }

  const running = await db.emailCampaign.findMany({ where: { status: "RUNNING" }, select: { id: true } });
  for (const { id } of running) {
    const pending = await db.emailMessage.count({ where: { campaignId: id, status: { in: ["QUEUED", "SENDING", "SCHEDULED"] } } });
    if (pending === 0) await db.emailCampaign.update({ where: { id }, data: { status: "COMPLETED", completedAt: now } });
  }
}

export interface TickSummary {
  recovered: number;
  promoted: number;
  swept: boolean;
  sent: number;
  failed: number;
  other: number;
}

// One pass of the email worker. Safe to run concurrently from several
// processes (every step is idempotent or row-claimed).
export async function runEmailTick(opts: { now?: Date; db?: PrismaClient; provider?: EmailProvider; forceSweep?: boolean } = {}): Promise<TickSummary> {
  const db = opts.db ?? prisma;
  const now = opts.now ?? new Date();
  await ensureEmailSystem(db);

  const recovered = (await recoverInterruptedSends(db, now)).count;
  const promoted = (await promoteScheduled(db, now)).count;

  let swept = false;
  if (opts.forceSweep || now.getTime() - lastSweepAt >= SWEEP_INTERVAL_MS) {
    lastSweepAt = now.getTime();
    swept = true;
    for (const [label, sweep] of [
      ["inspection", sweepInspectionEmails],
      ["invoice", sweepInvoiceReminders],
      ["birthday", sweepRealtorBirthdays],
      ["anniversary", sweepRealtorAnniversaries],
    ] as const) {
      try {
        await sweep(now, db);
      } catch (err) {
        console.error(`[email] ${label} sweep failed:`, err instanceof Error ? err.message : err);
      }
    }
    // Anything the sweeps just created for "now" goes out this tick.
    await promoteScheduled(db, now);
  }

  await runCampaigns(db, now);
  const outcomes = await sendDueEmails({ db, now, provider: opts.provider ?? getEmailProvider() });

  const summary = {
    recovered,
    promoted,
    swept,
    sent: outcomes.filter((o) => o.status === "SENT").length,
    failed: outcomes.filter((o) => o.status === "FAILED").length,
    other: outcomes.filter((o) => o.status !== "SENT" && o.status !== "FAILED").length,
  };
  if (summary.sent || summary.failed || summary.other || recovered) console.info("[email] tick", JSON.stringify(summary));
  return summary;
}
