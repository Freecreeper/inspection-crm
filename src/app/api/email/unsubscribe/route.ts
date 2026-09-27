import { NextResponse } from "next/server";
import { applyUnsubscribe } from "@/lib/email/preferences";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";

// RFC 8058 one-click unsubscribe (the List-Unsubscribe-Post header). POST
// only — mail scanners that follow links with GET can't unsubscribe anyone.
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  await applyUnsubscribe(verified.realtorId, verified.scope, "one-click unsubscribe");
  return NextResponse.json({ ok: true });
}
