import type { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { describeEmailDelivery } from "@/lib/email/config";
import { ensureEmailSystem } from "@/lib/email/system";
import { EmailNav } from "./_components/EmailNav";

export default async function EmailLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!can(session?.user?.role as Role | undefined, "email:view")) redirect("/dashboard");
  await ensureEmailSystem();
  const delivery = describeEmailDelivery();

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Email</h1>
      </div>
      <p
        role="status"
        className={`mt-3 rounded-md border px-3 py-2 text-sm ${
          delivery.delivers ? "border-slate-200 bg-white text-slate-700" : "border-amber-200 bg-amber-50 text-amber-900"
        }`}
      >
        <span className="font-medium">{delivery.mode === "live" ? "Live delivery." : delivery.mode === "redirect" ? "Redirected delivery." : "Delivery simulated."}</span>{" "}
        {delivery.summary}
      </p>
      <EmailNav />
      <div className="mt-6">{children}</div>
    </div>
  );
}
