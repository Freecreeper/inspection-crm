import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { NewRealtorForm } from "./NewRealtorForm";

export default async function NewRealtorPage() {
  const brokerages = await prisma.brokerage.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } });

  return (
    <div className="max-w-md">
      <Link href="/realtors" className="text-xs text-slate-500 hover:underline">
        ← Back to realtors
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">New realtor</h1>
      <NewRealtorForm brokerages={brokerages.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
