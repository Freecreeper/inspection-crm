import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { signOutAction } from "./actions";
import { AppSidebar } from "./AppSidebar";
import { PERMISSIONS, can, type Permission } from "@/lib/rbac";
import type { Role } from "@prisma/client";

function humanizeRole(role: string): string {
  if (!role) return "";
  return role
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const displayName = session.user.name ?? session.user.email ?? "Signed in";
  const role = session.user.role as Role;
  const granted = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));

  return (
    <div className="flex min-h-screen bg-canvas">
      <AppSidebar displayName={displayName} roleLabel={humanizeRole(session.user.role ?? "")} granted={granted} signOutAction={signOutAction}>
        {children}
      </AppSidebar>
    </div>
  );
}
