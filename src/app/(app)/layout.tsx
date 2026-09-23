import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { signOutAction } from "./actions";
import { AppSidebar } from "./AppSidebar";

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

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AppSidebar displayName={displayName} roleLabel={humanizeRole(session.user.role ?? "")} signOutAction={signOutAction}>
        {children}
      </AppSidebar>
    </div>
  );
}
