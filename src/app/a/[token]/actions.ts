"use server";

import { headers } from "next/headers";
import { signAgreement } from "@/lib/agreements/service";
import { clientIp } from "@/lib/security/loginThrottle";

// The customer's signature, from the public signing page. The signed
// token is the only credential; the IP and browser are kept as part of
// the signing record.
export async function signAgreementAction(token: string, input: { name: string; agreed: boolean }) {
  const h = await headers();
  return signAgreement(token, input, { ip: clientIp(h), userAgent: h.get("user-agent") });
}
