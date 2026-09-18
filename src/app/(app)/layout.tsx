import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/transactions", label: "Transactions" },
  { href: "/customers", label: "Customers" },
  { href: "/realtors", label: "Realtors" },
  { href: "/brokerages", label: "Brokerages" },
  { href: "/properties", label: "Properties" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4">
          <p className="font-mono text-[11px] uppercase tracking-wide text-slate-500">Inspection CRM</p>
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-200 px-4 py-3">
          <p className="truncate text-sm font-medium text-slate-800">{session.user.name}</p>
          <p className="font-mono text-[11px] text-slate-500">{session.user.role}</p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="mt-2 text-xs text-slate-500 hover:text-slate-800 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden px-8 py-8">{children}</main>
    </div>
  );
}
