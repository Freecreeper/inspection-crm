"use server";

import type { Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { saveAgreementWording } from "@/lib/agreements/service";

export async function saveAgreementWordingAction(input: { title: string; body: string }) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "agreement:manage");
  const result = await saveAgreementWording(session?.user?.id ?? null, input);
  if (result.ok) revalidatePath("/settings/agreement");
  return result;
}
