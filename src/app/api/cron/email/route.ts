import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEmailConfig } from "@/lib/email/config";
import { runEmailTick } from "@/lib/email/system";

// For hosts without a long-running process: a scheduler calls this with
// `Authorization: Bearer $EMAIL_WORKER_SECRET` every minute or so. Without
// a configured secret the endpoint is disabled entirely.
export async function POST(request: Request) {
  const secret = getEmailConfig().workerSecret;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const given = Buffer.from(header);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runEmailTick();
  return NextResponse.json(summary);
}
