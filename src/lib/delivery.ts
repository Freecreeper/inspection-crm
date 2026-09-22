import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Delivery-scoped access, independent of staff auth (§16) — this is the
// customer/realtor path proxy.ts carves out as public under /r/. Only ever
// looked up by the hash; the raw token is never stored anywhere.
export async function resolveDeliveryByToken(rawToken: string) {
  const accessTokenHash = createHash("sha256").update(rawToken).digest("hex");
  const delivery = await prisma.reportDelivery.findUnique({
    where: { accessTokenHash },
    include: {
      version: true,
      report: { include: { inspection: { include: { property: true } } } },
    },
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
