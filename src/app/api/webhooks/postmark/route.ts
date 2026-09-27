import { NextResponse } from "next/server";
import { processPostmarkPayload, verifyWebhookAuth } from "@/lib/email/webhooks";

// Postmark delivery/bounce/complaint/subscription webhooks. Authenticated
// with HTTP Basic credentials configured on the Postmark side; anything
// else is rejected before its body is read. Duplicates are acknowledged
// (200) so Postmark stops retrying, but applied only once.
export async function POST(request: Request) {
  if (!verifyWebhookAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  try {
    const { duplicate, event } = await processPostmarkPayload(payload as Record<string, never>);
    console.info(`[email] webhook ${event.type}${duplicate ? " (duplicate, ignored)" : ""} ${event.providerMessageId ?? ""}`);
    return NextResponse.json({ ok: true, duplicate });
  } catch (err) {
    console.error("[email] webhook processing failed:", err instanceof Error ? err.message : err);
    // 500 so Postmark retries later.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
