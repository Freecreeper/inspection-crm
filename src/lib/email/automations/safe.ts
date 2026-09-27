import { getAutomation, logAutomationEvent, type AutomationKey } from "./registry";

// CRM actions call automations *after* their own change has committed, and
// through this wrapper: an email problem never turns a saved inspection or
// payment into an error for the person who made it — but it is never
// silent either. It's written to the automation log as FAILED.
export async function runAutomationSafely<T>(
  target: { key: AutomationKey; entityType: string; entityId: string; actorId?: string | null },
  fn: () => Promise<T>
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[email] automation "${target.key}" failed for ${target.entityType} ${target.entityId}: ${reason}`);
    try {
      const auto = await getAutomation(target.key);
      await logAutomationEvent(auto.row.id, {
        entityType: target.entityType,
        entityId: target.entityId,
        result: "FAILED",
        detail: { reason },
        triggeredById: target.actorId ?? null,
      });
    } catch {
      // The database itself is unavailable; the console line above is all we can do.
    }
    return null;
  }
}
