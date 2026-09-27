import "dotenv/config";
import { runEmailTick } from "../src/lib/email/system";
import { describeEmailDelivery } from "../src/lib/email/config";

// Long-running email worker: `npm run worker`. Every step is idempotent or
// row-claimed, so running more than one of these is safe.
const INTERVAL_MS = Math.max(2_000, Number(process.env.EMAIL_WORKER_INTERVAL_MS ?? 10_000) || 10_000);
let stopping = false;

async function main() {
  console.info(`[email-worker] started — ${describeEmailDelivery().summary} Tick every ${INTERVAL_MS / 1000}s.`);
  while (!stopping) {
    try {
      await runEmailTick();
    } catch (err) {
      console.error("[email-worker] tick failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.info(`[email-worker] ${signal} received — finishing the current tick.`);
    stopping = true;
  });
}

main();
