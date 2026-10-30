"use server";

import type { Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { cancelSignatureRequest, requestSignature } from "@/lib/agreements/service";

// Asking a customer to sign is an office job, like marking it signed by hand.
async function requireStaff() {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");
  return session?.user?.id ?? null;
}

export async function requestSignatureAction(inspectionId: string, customerId?: string | null) {
  const result = await requestSignature(await requireStaff(), inspectionId, customerId);
  if (result.ok) revalidatePath(`/inspections/${inspectionId}`);
  return result;
}

export async function cancelSignatureRequestAction(agreementId: string) {
  const result = await cancelSignatureRequest(await requireStaff(), agreementId);
  if (result.ok) revalidatePath(`/inspections/${result.data.inspectionId}`);
  return result;
}
