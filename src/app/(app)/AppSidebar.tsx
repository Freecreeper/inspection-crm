"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { trapTabKey } from "@/components/focusTrap";
import type { Permission } from "@/lib/rbac";
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
  Send,
  FileText,
  BookOpen,
  BarChart3,
  Receipt,
  KeyRound,
  UserCog,
  Package,
  LayoutTemplate,
  ChevronDown,
  Menu,
  X,
} from "lucide-react";

// `requires` hides a link from roles that can't use the page (the page
// itself still enforces the permission).
type NavItem = { href: string; label: string; icon: LucideIcon; requires?: Permission };

// Grouped by kind of work: the inspection side (jobs, what's offered, what
// goes into reports) is kept apart from the relationship side (Realtors,
// brokerages, referrals, follow-up tasks).
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    label: "Inspections",
    items: [
      { href: "/inspections", label: "Inspections", icon: MapPin },
      { href: "/services", label: "Services & Packages", icon: Package },
      { href: "/report-templates", label: "Report Templates", icon: LayoutTemplate },
      { href: "/narratives", label: "Narratives", icon: BookOpen },
      { href: "/invoices", label: "Invoices", icon: Receipt, requires: "financial:read" },
    ],
  },
  {
    label: "Relationships",
    items: [
      { href: "/realtors", label: "Realtors", icon: Contact },
      { href: "/brokerages", label: "Brokerages", icon: Building2 },
      { href: "/referral-sources", label: "Referral sources", icon: Star },
      { href: "/tasks", label: "Tasks", icon: CheckSquare },
    ],
  },
  {
    label: "Clients & deals",
    items: [
      { href: "/leads", label: "Leads", icon: UserPlus },
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/transactions", label: "Transactions", icon: ArrowRightLeft },
      { href: "/properties", label: "Properties", icon: Home },
    ],
  },
  {
    label: "Communication",
    items: [
      { href: "/email", label: "Email", icon: Send },
      { href: "/communications", label: "Communications", icon: Mail },
      { href: "/documents", label: "Documents", icon: FileText },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3, requires: "report-builder:use" },
      { href: "/settings/users", label: "Users", icon: UserCog, requires: "user:manage" },
    ],
  },
];

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const COLLAPSE_STORAGE_KEY = "sidebar-collapsed";
// Labels of the nav groups folded shut, as a JSON array (per browser).
const CLOSED_GROUPS_STORAGE_KEY = "sidebar-closed-groups";

function activeGroupLabel(pathname: string): string | undefined {
  return NAV_GROUPS.find((g) => g.items.some((i) => isActivePath(pathname, i.href)))?.label;
}

function groupListId(label: string): string {
  return `nav-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

// Which groups are folded shut. The group holding the current page is
// opened on load and on every navigation, so the active link never hides.
function useClosedGroups(pathname: string) {
  const [closed, setClosed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [seenPath, setSeenPath] = useState(pathname);

  useEffect(() => {
    // Same reason as the sidebar collapse below: localStorage only exists
    // after mount.
    let stored: string[] = [];
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(CLOSED_GROUPS_STORAGE_KEY) ?? "[]");
      if (Array.isArray(parsed)) stored = parsed.filter((v): v is string => typeof v === "string");
    } catch {
      // Missing, malformed, or blocked storage — every group starts open.
    }
    const active = activeGroupLabel(pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClosed(stored.filter((label) => label !== active));
    setLoaded(true);
    // Mount only; navigation is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pathname !== seenPath) {
    setSeenPath(pathname);
    const active = activeGroupLabel(pathname);
    if (active && closed.includes(active)) setClosed(closed.filter((label) => label !== active));
  }

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(CLOSED_GROUPS_STORAGE_KEY, JSON.stringify(closed));
    } catch {
      // Ignore — folding still works for this page view, just won't persist.
    }
  }, [closed, loaded]);

  function toggle(label: string) {
    setClosed((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
  }

  return { isOpen: (label: string) => !closed.includes(label), toggle };
}

export function AppSidebar({
  displayName,
  roleLabel,
  granted = [],
  signOutAction,
  children,
}: {
  displayName: string;
  roleLabel: string;
  // The permissions the signed-in role has (decided on the server).
  granted?: Permission[];
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

  // Phones and small tablets: the sidebar is an overlay opened from the
  // menu button, never part of the page layout, so pages get the full width.
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileButtonRef = useRef<HTMLButtonElement>(null);

  const content = (onNavigate: () => void) => (
    <SidebarContent pathname={pathname} displayName={displayName} roleLabel={roleLabel} granted={granted} signOutAction={signOutAction} onNavigate={onNavigate} />
  );

  return (
    <>
      {/* Desktop: in the layout, collapsible, remembered per browser. */}
      <aside
        className={`hidden shrink-0 overflow-hidden border-slate-200 bg-white transition-[width] duration-200 lg:block ${
          collapsed ? "w-0" : "w-64 border-r"
        }`}
      >
        <div className="flex h-full w-64 flex-col">{content(() => setCollapsedPersisted(true))}</div>
      </aside>

      {mobileOpen && (
        <MobileSidebar
          onClose={() => {
            setMobileOpen(false);
            mobileButtonRef.current?.focus();
          }}
          pathname={pathname}
        >
          {content(() => setMobileOpen(false))}
        </MobileSidebar>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
          <button
            ref={mobileButtonRef}
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            aria-controls="mobile-sidebar"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden h-9 w-9 cursor-pointer items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:flex"
          >
            {collapsed ? <Menu className="h-5 w-5" /> : <X className="h-5 w-5" />}
          </button>
          <p className="text-sm font-bold uppercase tracking-wide text-slate-900 lg:hidden">Inspection CRM</p>
        </div>
        <main className="flex-1 overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </>
  );
}

// A modal sheet from the left: backdrop, focus kept inside, Escape or a
// backdrop tap closes it, and so does navigating (including browser back).
function MobileSidebar({ onClose, pathname, children }: { onClose: () => void; pathname: string; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openedAt = useRef(pathname);

  useEffect(() => {
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (pathname !== openedAt.current) onClose();
  }, [pathname, onClose]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (panelRef.current) trapTabKey(panelRef.current, event);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-slate-900/40" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        id="mobile-sidebar"
        role="dialog"
        aria-modal="true"
        aria-label="Main menu"
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="absolute right-2 top-4 flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>
  );
}

function SidebarContent({
  pathname,
  displayName,
  roleLabel,
  granted,
  signOutAction,
  onNavigate,
}: {
  pathname: string;
  displayName: string;
  roleLabel: string;
  granted: Permission[];
  signOutAction: () => Promise<void>;
  onNavigate: () => void;
}) {
  const { isOpen, toggle } = useClosedGroups(pathname);
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.requires || granted.includes(i.requires)) })).filter((g) => g.items.length > 0);
  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600">
          <Home className="h-5 w-5 text-white" strokeWidth={2.25} />
        </div>
        <div className="min-w-0 pr-8 lg:pr-0">
          <p className="truncate text-sm font-bold uppercase tracking-wide text-slate-900">Inspection CRM</p>
          <p className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-400">
            People &bull; Properties &bull; Progress
          </p>
        </div>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.label}>
            <button
              type="button"
              onClick={() => toggle(group.label)}
              aria-expanded={isOpen(group.label)}
              aria-controls={groupListId(group.label)}
              className="flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            >
              {group.label}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen(group.label) ? "" : "-rotate-90"}`} aria-hidden="true" />
            </button>
            <div id={groupListId(group.label)} hidden={!isOpen(group.label)} className="mt-1 space-y-0.5">
              {group.items.map((item) => {
                const active = isActivePath(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
                      active ? "bg-emerald-50 text-emerald-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
        <div className="mt-2.5 flex items-center gap-4">
          <Link href="/account/password" onClick={onNavigate} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 hover:underline">
            <KeyRound className="h-3 w-3" aria-hidden="true" /> Change password
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="text-xs text-slate-500 hover:text-slate-800 hover:underline">
              Sign out
            </button>
          </form>
        </div>
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
