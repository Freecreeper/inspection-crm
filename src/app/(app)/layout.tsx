import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth, signOut } from "@/lib/auth";
import {
  type LucideIcon,
  LayoutDashboard,
  CalendarDays,
  UserPlus,
  ArrowRightLeft,
  MapPin,
  Users,
  Contact,
  Building2,
  Home,
  Star,
  CheckSquare,
  Mail,
  FileText,
  BookOpen,
  BarChart3,
  Menu,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/leads", label: "Leads", icon: UserPlus },
      { href: "/transactions", label: "Transactions", icon: ArrowRightLeft },
      { href: "/inspections", label: "Inspections", icon: MapPin },
    ],
  },
  {
    label: "Contacts",
    items: [
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/realtors", label: "Realtors", icon: Contact },
      { href: "/brokerages", label: "Brokerages", icon: Building2 },
    ],
  },
  {
    label: "Data",
    items: [
      { href: "/properties", label: "Properties", icon: Home },
      { href: "/referral-sources", label: "Referral sources", icon: Star },
    ],
  },
  {
    label: "Work",
    items: [
      { href: "/tasks", label: "Tasks", icon: CheckSquare },
      { href: "/communications", label: "Communications", icon: Mail },
      { href: "/documents", label: "Documents", icon: FileText },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/narratives", label: "Narratives", icon: BookOpen },
      { href: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
];

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

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

  // Set by proxy.ts on every request — lets this Server Component highlight
  // the active nav item without a client-side usePathname() hook.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const displayName = session.user.name ?? session.user.email ?? "Signed in";

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/*
        A checkbox drives the collapse — no client JS needed. It's a real
        sibling of both the <aside> and the main column below, so Tailwind's
        peer-checked: variant can reach both: the <aside> collapses its
        width, and the hamburger's own icon within the main column doesn't
        need to change (kept as a single static icon deliberately, since
        peer-checked: only reaches direct siblings of the checkbox — not
        arbitrary descendants nested inside one).
      */}
      <input type="checkbox" id="sidebar-toggle" defaultChecked className="peer hidden" />

      <aside className="w-0 shrink-0 overflow-hidden border-slate-200 bg-white transition-[width] duration-200 peer-checked:w-64 peer-checked:border-r">
        <div className="flex h-full w-64 flex-col">
          <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600">
              <Home className="h-5 w-5 text-white" strokeWidth={2.25} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold uppercase tracking-wide text-slate-900">Inspection CRM</p>
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-400">
                People &bull; Properties &bull; Progress
              </p>
            </div>
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</p>
                <div className="mt-1.5 space-y-0.5">
                  {group.items.map((item) => {
                    const active = isActivePath(pathname, item.href);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
                          active
                            ? "bg-emerald-50 text-emerald-800"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        }`}
                      >
                        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-emerald-600" : "text-slate-400"}`} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-800">
                {initialsOf(displayName)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{displayName}</p>
                <p className="truncate text-xs text-slate-500">{humanizeRole(session.user.role ?? "")}</p>
              </div>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button type="submit" className="mt-2.5 text-xs text-slate-500 hover:text-slate-800 hover:underline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center border-b border-slate-200 bg-white px-4 py-2.5">
          <label
            htmlFor="sidebar-toggle"
            title="Toggle sidebar"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <Menu className="h-5 w-5" />
          </label>
        </div>
        <main className="flex-1 overflow-x-hidden px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
