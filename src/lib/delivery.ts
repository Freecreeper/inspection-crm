import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Delivery-scoped access, independent of staff auth (§16) — this is the
// customer/realtor path proxy.ts carves out as public under /r/. Only ever
// looked up by the hash; the raw token is never stored anywhere.
//
// Deliberately does NOT include the live `report`/`inspection`/`property`
// relations: everything the public path may show comes from the immutable
// `version.snapshot` captured at finalization instead, so a Property edit
// (or any other later CRM change) can never change what an already-delivered
// report version displays. Pull `version` only — see ReportSnapshot in
// reportEngine.ts for what it carries.
export async function resolveDeliveryByToken(rawToken: string) {
  const accessTokenHash = createHash("sha256").update(rawToken).digest("hex");
  const delivery = await prisma.reportDelivery.findUnique({
    where: { accessTokenHash },
    include: { version: true },
  });
  if (!delivery) return null;
  if (delivery.accessExpiresAt < new Date()) return null;
  return delivery;
}

export async function markDeliveryViewed(deliveryId: string): Promise<void> {
  await prisma.reportDelivery.updateMany({
    where: { id: deliveryId, status: { not: "VIEWED" } },
    data: { status: "VIEWED" },
  });
}
