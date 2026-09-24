"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  X,
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

const COLLAPSE_STORAGE_KEY = "sidebar-collapsed";

export function AppSidebar({
  displayName,
  roleLabel,
  signOutAction,
  children,
}: {
  displayName: string;
  roleLabel: string;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Starts expanded (matches the pre-JS default) and is corrected from
  // localStorage right after mount — avoids a server/client markup mismatch
  // since localStorage isn't available during server rendering.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // localStorage is a browser-only API — there's no way to read it before
    // this first-mount effect without an SSR/client markup mismatch, so this
    // one deliberately breaks the "don't setState synchronously in an
    // effect" guideline.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true");
    } catch {
      // Private browsing / blocked storage — fall back to the expanded default.
    }
  }, []);

  function setCollapsedPersisted(next: boolean) {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
    } catch {
      // Ignore — collapse still works for this session, just won't persist.
    }
  }

  function toggleCollapsed() {
    setCollapsedPersisted(!collapsed);
  }

  return (
    <>
      <aside
        className={`shrink-0 overflow-hidden border-slate-200 bg-white transition-[width] duration-200 ${
          collapsed ? "w-0" : "w-64 border-r"
        }`}
      >
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
                        onClick={() => setCollapsedPersisted(true)}
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
                <p className="truncate text-xs text-slate-500">{roleLabel}</p>
              </div>
            </div>
            <form action={signOutAction}>
              <button type="submit" className="mt-2.5 text-xs text-slate-500 hover:text-slate-800 hover:underline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center border-b border-slate-200 bg-white px-4 py-2.5">
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            {collapsed ? <Menu className="h-5 w-5" /> : <X className="h-5 w-5" />}
          </button>
        </div>
        <main className="flex-1 overflow-x-hidden px-8 py-8">{children}</main>
      </div>
    </>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}
