"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  ChevronUp,
  GripVertical,
  ArrowUpDown,
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
// The nav groups' labels in the order this browser arranged them.
const GROUP_ORDER_STORAGE_KEY = "sidebar-group-order";

// Saved labels come first, in their saved order; any group the saved order
// doesn't name (added since, or hidden from the role that saved it) keeps
// its default position relative to the others, after them.
export function orderGroups<T extends { label: string }>(groups: T[], order: string[]): T[] {
  const rank = (g: T, i: number) => {
    const saved = order.indexOf(g.label);
    return saved === -1 ? order.length + i : saved;
  };
  return groups.map((g, i) => ({ g, r: rank(g, i) })).sort((a, b) => a.r - b.r).map(({ g }) => g);
}

function activeGroupLabel(pathname: string): string | undefined {
  return NAV_GROUPS.find((g) => g.items.some((i) => isActivePath(pathname, i.href)))?.label;
}

function groupListId(label: string): string {
  return `nav-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

// Which groups are folded shut. The group holding the current page is
// opened on load and on every navigation, so the active link never hides.
// A JSON array of group labels saved under `key`, or [] when it's missing,
// malformed, or storage is blocked.
function readStoredLabels(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function useClosedGroups(pathname: string) {
  const [closed, setClosed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [seenPath, setSeenPath] = useState(pathname);

  useEffect(() => {
    // Same reason as the sidebar collapse below: localStorage only exists
    // after mount.
    const stored = readStoredLabels(CLOSED_GROUPS_STORAGE_KEY);
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

  // Folding animates only once the saved state has been applied, so groups
  // folded in an earlier visit don't visibly fold shut on every page load
  // (or every time the mobile menu opens).
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (!loaded) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [loaded]);

  function toggle(label: string) {
    setClosed((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
  }

  return { isOpen: (label: string) => !closed.includes(label), toggle, animate };
}

// `dragged` taken out and put in `target`'s place: coming from above, it
// lands just after the target; from below, just before.
export function moveLabel(labels: string[], dragged: string, target: string): string[] {
  const from = labels.indexOf(dragged);
  const to = labels.indexOf(target);
  if (from === -1 || to === -1 || from === to) return labels;
  const next = labels.filter((l) => l !== dragged);
  next.splice(to, 0, dragged);
  return next;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function groupElements(nav: HTMLElement): HTMLElement[] {
  return [...nav.querySelectorAll<HTMLElement>(":scope > [data-group]")];
}

// The translateY a running animation currently applies to `el`.
function currentTranslateY(el: HTMLElement): number {
  const transform = getComputedStyle(el).transform;
  return transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m42 : 0;
}

// A short highlight on a group that just moved, so the eye can find it.
function flashGroup(nav: HTMLElement | null, label: string) {
  const bar = nav?.querySelector(`:scope > [data-group="${label}"]`)?.firstElementChild;
  if (!(bar instanceof HTMLElement) || typeof bar.animate !== "function" || prefersReducedMotion()) return;
  bar.animate(
    [
      { boxShadow: "0 0 0 3px rgb(16 185 129 / 0.45)", backgroundColor: "rgb(236 253 245)" },
      { boxShadow: "0 0 0 3px rgb(16 185 129 / 0)" },
    ],
    { duration: 700, easing: "ease-out" }
  );
}

// Reordering motion (FLIP): call the returned `snapshot` just before changing
// the order; once it changes, each group starts where it was and glides to
// its new place. Positions come from offsetTop, which ignores transforms,
// plus whatever offset a running glide has reached, so a glide cut short by
// the next move carries on from where it visibly is. Entering arrange mode
// fades the bars in one after another.
function useReorderMotion(navRef: React.RefObject<HTMLElement | null>, orderKey: string, arranging: boolean) {
  const before = useRef<Map<string, number> | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const tops = before.current;
    before.current = null;
    if (!nav || !tops || prefersReducedMotion()) return;
    for (const el of groupElements(nav)) {
      const prev = tops.get(el.dataset.group!);
      if (prev === undefined || prev === el.offsetTop || typeof el.animate !== "function") continue;
      const from = prev - el.offsetTop + currentTranslateY(el);
      el.getAnimations().forEach((a) => a.cancel());
      el.animate([{ transform: `translateY(${from}px)` }, { transform: "translateY(0)" }], { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
  }, [navRef, orderKey]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || !arranging || prefersReducedMotion()) return;
    groupElements(nav).forEach((el, i) => {
      const bar = el.firstElementChild;
      if (bar instanceof HTMLElement && typeof bar.animate === "function") {
        bar.animate([{ opacity: 0, transform: "translateY(-6px) scale(0.98)" }, { opacity: 1, transform: "none" }], {
          duration: 200,
          delay: i * 35,
          easing: "ease-out",
          fill: "backwards",
        });
      }
    });
  }, [navRef, arranging]);

  return function snapshot() {
    const nav = navRef.current;
    if (nav) before.current = new Map(groupElements(nav).map((el) => [el.dataset.group!, el.offsetTop]));
  };
}

function useGroupOrder() {
  const [order, setOrder] = useState<string[]>([]);

  useEffect(() => {
    // localStorage only exists after mount (see the sidebar collapse below).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder(readStoredLabels(GROUP_ORDER_STORAGE_KEY));
  }, []);

  function save(next: string[]) {
    setOrder(next);
    try {
      if (next.length) localStorage.setItem(GROUP_ORDER_STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(GROUP_ORDER_STORAGE_KEY);
    } catch {
      // Ignore — the new order holds for this page view, just won't persist.
    }
  }

  return { order, save };
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
  const [animateCollapse, setAnimateCollapse] = useState(false);

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
    // Animate only from the next frame on, so a sidebar collapsed on an
    // earlier visit starts collapsed instead of visibly sliding shut.
    const frame = requestAnimationFrame(() => setAnimateCollapse(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function setCollapsedPersisted(next: boolean) {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
    } catch {
      // Ignore — collapse still works for this session, just won't persist.
    }
  }

  const iconMotion = animateCollapse ? "transition-[rotate,opacity,scale] duration-300 motion-reduce:transition-none" : "";

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
      {/* Desktop: in the layout, collapsible, remembered per browser. The
          width eases shut while the contents slide out and fade; collapsed,
          they're inert so Tab can't reach links that aren't on screen. */}
      <aside
        className={`hidden shrink-0 overflow-hidden border-r bg-white bg-clip-padding lg:block ${
          animateCollapse ? "transition-[width,border-color] duration-300 ease-in-out motion-reduce:transition-none" : ""
        } ${collapsed ? "w-0 border-transparent" : "w-64 border-slate-200"}`}
      >
        <div
          inert={collapsed}
          className={`flex h-full w-64 flex-col ${animateCollapse ? "transition-[opacity,translate] duration-300 ease-in-out motion-reduce:transition-none" : ""} ${
            collapsed ? "-translate-x-6 opacity-0" : "translate-x-0 opacity-100"
          }`}
        >
          {content(() => setCollapsedPersisted(true))}
        </div>
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
            className="relative hidden h-9 w-9 cursor-pointer items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:flex"
          >
            {/* Both icons stay mounted and swap with a turn and a fade. */}
            <Menu
              className={`absolute h-5 w-5 ${iconMotion} ${collapsed ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-75 opacity-0"}`}
              aria-hidden="true"
            />
            <X
              className={`absolute h-5 w-5 ${iconMotion} ${collapsed ? "rotate-90 scale-75 opacity-0" : "rotate-0 scale-100 opacity-100"}`}
              aria-hidden="true"
            />
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
  const { isOpen, toggle, animate: animateFolding } = useClosedGroups(pathname);
  const { order, save: saveOrder } = useGroupOrder();
  // Arrange mode: headings become drag handles with move buttons, and the
  // links are tucked away so the whole list fits.
  const [arranging, setArranging] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  // While dragging, the order the list shows (live, unsaved); saved on drop,
  // dropped on cancel.
  const [preview, setPreview] = useState<string[] | null>(null);
  // Brief pause after each live move so a neighbour gliding past the
  // pointer doesn't immediately swap back.
  const settleUntil = useRef(0);
  const navRef = useRef<HTMLElement>(null);
  const allowed = orderGroups(NAV_GROUPS, order).map((g) => ({ ...g, items: g.items.filter((i) => !i.requires || granted.includes(i.requires)) })).filter((g) => g.items.length > 0);
  const groups = preview ? orderGroups(allowed, preview) : allowed;
  const snapshot = useReorderMotion(navRef, groups.map((g) => g.label).join("|"), arranging);
  // Moves happen within the groups this role sees; the rest keep their
  // default places after them (orderGroups).
  function moveGroup(label: string, delta: -1 | 1) {
    const labels = groups.map((g) => g.label);
    const from = labels.indexOf(label);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= labels.length) return;
    [labels[from], labels[to]] = [labels[to], labels[from]];
    snapshot();
    saveOrder(labels);
    // The group's DOM node moves, which can drop focus; put it back on the
    // same button, or the other one once it reaches the end of the list.
    requestAnimationFrame(() => {
      const button = (dir: string) => navRef.current?.querySelector<HTMLButtonElement>(`[data-move="${label}:${dir}"]`);
      const same = button(delta < 0 ? "up" : "down");
      (same && !same.disabled ? same : button(delta < 0 ? "down" : "up"))?.focus();
      flashGroup(navRef.current, label);
    });
  }

  // `at` is the dragover event's timestamp.
  function dragOverGroup(target: string, at: number) {
    if (!dragging || target === dragging || at < settleUntil.current) return;
    const current = groups.map((g) => g.label);
    const next = moveLabel(current, dragging, target);
    if (next === current) return;
    settleUntil.current = at + 250;
    snapshot();
    setPreview(next);
  }

  function endDrag() {
    snapshot();
    setDragging(null);
    setPreview(null);
  }

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

      <nav
        ref={navRef}
        aria-label="Main"
        // Drops land anywhere in the list, gaps included; the live preview
        // already shows where.
        onDragOver={(e) => {
          if (dragging) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!dragging) return;
          e.preventDefault();
          const label = dragging;
          if (preview) saveOrder(preview);
          endDrag();
          requestAnimationFrame(() => flashGroup(navRef.current, label));
        }}
        className={`relative flex-1 overflow-y-auto px-3 py-4 ${arranging ? "space-y-1.5" : "space-y-3"}`}
      >
        {groups.map((group, index) => (
          <div
            key={group.label}
            data-group={group.label}
            draggable={arranging}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", group.label);
              settleUntil.current = 0;
              setDragging(group.label);
              setPreview(groups.map((g) => g.label));
            }}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              dragOverGroup(group.label, e.timeStamp);
            }}
            onDragEnd={endDrag}
          >
            {arranging ? (
              // The dragged group stays in the list as a dashed placeholder
              // marking where it will land.
              <div
                className={`flex cursor-grab items-center gap-1.5 rounded-md border py-1 pl-2 pr-1 text-[11px] font-semibold uppercase tracking-wider transition-[color,background-color,border-color,box-shadow] duration-150 ${
                  dragging === group.label
                    ? "border-dashed border-emerald-400 bg-emerald-50 text-emerald-700 opacity-70"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:shadow-sm"
                }`}
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                <button
                  type="button"
                  data-move={`${group.label}:up`}
                  onClick={() => moveGroup(group.label, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${group.label} up`}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-slate-500 hover:bg-white hover:text-slate-800 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  data-move={`${group.label}:down`}
                  onClick={() => moveGroup(group.label, 1)}
                  disabled={index === groups.length - 1}
                  aria-label={`Move ${group.label} down`}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-slate-500 hover:bg-white hover:text-slate-800 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => toggle(group.label)}
                aria-expanded={isOpen(group.label)}
                aria-controls={groupListId(group.label)}
                className="flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:bg-slate-50 hover:text-slate-600"
              >
                {group.label}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${isOpen(group.label) ? "" : "-rotate-90"}`} aria-hidden="true" />
              </button>
            )}
            {/* Folds by animating the row height between 0 and the content's own
                height; closed content is inert, so it can't be tabbed to or read. */}
            <div
              id={groupListId(group.label)}
              inert={arranging || !isOpen(group.label)}
              aria-hidden={arranging || !isOpen(group.label)}
              className={`grid ${animateFolding ? "transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none" : ""} ${
                arranging || !isOpen(group.label) ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
              }`}
            >
              {/* Side padding keeps the links' focus outlines clear of the clip. */}
              <div className="-mx-1 min-h-0 overflow-hidden px-1">
                <div className="space-y-0.5 pb-0.5 pt-1">
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
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3 px-3 pt-2">
          {arranging ? (
            <>
              <button
                type="button"
                onClick={() => setArranging(false)}
                className="cursor-pointer rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => {
                  snapshot();
                  saveOrder([]);
                }}
                disabled={order.length === 0}
                className="cursor-pointer text-xs text-slate-500 hover:text-slate-800 hover:underline disabled:cursor-default disabled:opacity-40 disabled:hover:no-underline"
              >
                Reset order
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setArranging(true)} className="inline-flex cursor-pointer items-center gap-1 text-xs text-slate-400 hover:text-slate-700 hover:underline">
              <ArrowUpDown className="h-3 w-3" aria-hidden="true" /> Reorder sections
            </button>
          )}
        </div>
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
