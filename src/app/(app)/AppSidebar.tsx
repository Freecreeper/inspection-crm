"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { trapTabKey } from "@/components/focusTrap";
import type { Permission } from "@/lib/rbac";
import {
  Home,
  KeyRound,
  ChevronDown,
  ChevronUp,
  GripVertical,
  ArrowUpDown,
  Menu,
  X,
  ArrowLeft,
  Palette,
  LogOut,
} from "lucide-react";

import { NAV_GROUPS, groupForPath, isActivePath, visibleGroups } from "./navigation";

const COLLAPSE_STORAGE_KEY = "sidebar-collapsed";
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

// The browser's own drag image is a picture of the dragged element's area,
// which can take in the groups around it, so several titles seem to move at
// once. Drag a detached copy of just this group's heading bar instead.
function setBarDragImage(e: React.DragEvent, bar: Element | null) {
  if (!(bar instanceof HTMLElement) || typeof e.dataTransfer.setDragImage !== "function") return;
  const rect = bar.getBoundingClientRect();
  const ghost = bar.cloneNode(true) as HTMLElement;
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    top: "-1000px",
    left: "0",
    width: `${rect.width}px`,
    pointerEvents: "none",
    background: "var(--color-surface)",
    boxShadow: "0 8px 20px color-mix(in oklab, var(--color-scrim) 15%, transparent)",
  });
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, e.clientX - rect.left, e.clientY - rect.top);
  // The browser has taken its picture by the next frame.
  requestAnimationFrame(() => ghost.remove());
}

// A short highlight on a group that just moved, so the eye can find it.
function flashGroup(nav: HTMLElement | null, label: string) {
  const bar = nav?.querySelector(`:scope > [data-group="${label}"]`)?.firstElementChild;
  if (!(bar instanceof HTMLElement) || typeof bar.animate !== "function" || prefersReducedMotion()) return;
  bar.animate(
    [
      { boxShadow: "0 0 0 3px color-mix(in oklab, var(--color-accent-500) 45%, transparent)", backgroundColor: "var(--color-accent-50)" },
      { boxShadow: "0 0 0 3px color-mix(in oklab, var(--color-accent-500) 0%, transparent)" },
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
  actions,
  children,
}: {
  displayName: string;
  roleLabel: string;
  // The permissions the signed-in role has (decided on the server).
  granted?: Permission[];
  signOutAction: () => Promise<void>;
  // The top bar's right side (global search, "+ New").
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Starts expanded (matches the pre-JS default) and is corrected from
  // localStorage right after mount — avoids a server/client markup mismatch
  // since localStorage isn't available during server rendering.
  const [collapsed, setCollapsed] = useState(false);
  const [animateCollapse, setAnimateCollapse] = useState(false);
  // The rail/full contents fade in only after the viewer toggles: adding
  // the animation class after load would otherwise replay it on every
  // page load.
  const [fadeContents, setFadeContents] = useState(false);

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
    setFadeContents(true);
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
      {/* Desktop: in the layout, remembered per browser. Collapsed, it eases
          down to an icon rail (every page still one click away, names in
          tooltips) instead of disappearing; the new contents fade in. */}
      <aside
        className={`hidden shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar lg:block ${
          animateCollapse ? "transition-[width] duration-300 ease-in-out motion-reduce:transition-none" : ""
        } ${collapsed ? "w-16" : "w-64"}`}
      >
        {collapsed ? (
          <div key="rail" className={`flex h-full w-16 flex-col ${fadeContents ? "animate-fade-in motion-reduce:animate-none" : ""}`}>
            <SidebarRail pathname={pathname} displayName={displayName} roleLabel={roleLabel} granted={granted} signOutAction={signOutAction} />
          </div>
        ) : (
          <div key="full" className={`flex h-full w-64 flex-col ${fadeContents ? "animate-fade-in motion-reduce:animate-none" : ""}`}>
            {content(() => setCollapsedPersisted(true))}
          </div>
        )}
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
        <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
          <button
            ref={mobileButtonRef}
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            aria-controls="mobile-sidebar"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-neutral-100 hover:text-neutral-800 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="relative hidden h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-neutral-100 hover:text-neutral-800 lg:flex"
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
          {/* A way up without opening the menu: a page goes back to its
              section's board, a board (or anything else) to Overview. On
              phones it takes the place of the app name. */}
          {isActivePath(pathname, "/dashboard") ? (
            <p className="text-sm font-bold uppercase tracking-wide text-foreground lg:hidden">Inspection CRM</p>
          ) : (
            (() => {
              const section = groupForPath(pathname);
              const up = section && !isActivePath(pathname, section.href) ? section : NAV_GROUPS[0];
              return (
                <Link
                  href={up.href}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-neutral-100 hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">{up.label}</span>
                </Link>
              );
            })()
          )}
          {actions}
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
      <div className="absolute inset-0 bg-scrim/40" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        id="mobile-sidebar"
        role="dialog"
        aria-modal="true"
        aria-label="Main menu"
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-sidebar shadow-xl"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="absolute right-2 top-4 flex h-9 w-9 items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-strong"
        >
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>
  );
}

// The collapsed desktop sidebar: the same groups, in the viewer's order and
// filtered by permission, as icons. Each link is named for screen readers
// (aria-label) and shows its name in a tooltip on hover or keyboard focus.
// The tooltip is fixed-position so the rail's scrolling can't clip it.
function SidebarRail({
  pathname,
  displayName,
  roleLabel,
  granted,
  signOutAction,
}: {
  pathname: string;
  displayName: string;
  roleLabel: string;
  granted: Permission[];
  signOutAction: () => Promise<void>;
}) {
  const { order } = useGroupOrder();
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const groups = orderGroups(visibleGroups(granted), order);
  const current = groupForPath(pathname)?.board;

  const tipProps = (label: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showTip(e.currentTarget, label),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => showTip(e.currentTarget, label),
    onBlur: () => setTip(null),
  });
  function showTip(el: HTMLElement, label: string) {
    const rect = el.getBoundingClientRect();
    setTip({ label, top: rect.top + rect.height / 2, left: rect.right + 8 });
  }

  const iconButton = "relative flex h-10 w-10 items-center justify-center rounded-md";
  return (
    <>
      <div className="flex justify-center border-b border-sidebar-border py-5">
        <Link href="/dashboard" aria-label="Dashboard" {...tipProps("Inspection CRM")} className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
          <Home className="h-5 w-5 text-white" strokeWidth={2.25} aria-hidden="true" />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-3" onScroll={() => setTip(null)}>
        <ul className="space-y-1">
          {groups.map((group) => (
            <li key={group.label}>
              <Link
                href={group.href}
                aria-label={group.label}
                aria-current={current === group.board ? "page" : undefined}
                {...tipProps(group.label)}
                className={`${iconButton} ${current === group.board ? "bg-sidebar-active text-sidebar-active-foreground" : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-strong"}`}
              >
                <group.icon className="h-[18px] w-[18px]" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col items-center gap-1 border-t border-sidebar-border py-3">
        <span
          tabIndex={0}
          aria-label={`${displayName}, ${roleLabel}`}
          {...tipProps(`${displayName} · ${roleLabel}`)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent-800 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {initialsOf(displayName)}
        </span>
        <Link href="/settings/appearance" aria-label="Appearance" {...tipProps("Appearance")} className={`${iconButton} text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-strong`}>
          <Palette className="h-4 w-4" aria-hidden="true" />
        </Link>
        <form action={signOutAction}>
          <button type="submit" aria-label="Sign out" {...tipProps("Sign out")} className={`${iconButton} cursor-pointer text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-strong`}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      </div>

      {tip && (
        <span
          aria-hidden="true"
          style={{ top: tip.top, left: tip.left }}
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-md"
        >
          {tip.label}
        </span>
      )}
    </>
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
  const allowed = orderGroups(visibleGroups(granted), order);
  const current = groupForPath(pathname)?.board;
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
      <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">
          <Home className="h-5 w-5 text-white" strokeWidth={2.25} />
        </div>
        <div className="min-w-0 pr-8 lg:pr-0">
          <p className="truncate text-sm font-bold uppercase tracking-wide text-sidebar-strong">Inspection CRM</p>
          <p className="truncate text-[10px] font-medium uppercase tracking-wider text-sidebar-muted">
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
        className={`relative flex-1 overflow-y-auto px-3 py-4 ${arranging ? "space-y-1.5" : "space-y-1"}`}
      >
        {groups.map((group, index) => (
          <div
            key={group.label}
            data-group={group.label}
            draggable={arranging}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", group.label);
              setBarDragImage(e, e.currentTarget.firstElementChild);
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
                    ? "border-dashed border-accent-400 bg-selected text-link opacity-70"
                    : "border-sidebar-border bg-sidebar-hover text-sidebar-foreground hover:shadow-sm"
                }`}
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-sidebar-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                <button
                  type="button"
                  data-move={`${group.label}:up`}
                  onClick={() => moveGroup(group.label, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${group.label} up`}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-sidebar-muted hover:bg-sidebar hover:text-sidebar-strong disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  data-move={`${group.label}:down`}
                  onClick={() => moveGroup(group.label, 1)}
                  disabled={index === groups.length - 1}
                  aria-label={`Move ${group.label} down`}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-sidebar-muted hover:bg-sidebar hover:text-sidebar-strong disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              // One link per section: it opens the section's board, and is
              // current on the board and on every page in the section.
              <Link
                href={group.href}
                onClick={onNavigate}
                aria-current={current === group.board ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                  current === group.board ? "bg-sidebar-active text-sidebar-active-foreground" : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-strong"
                }`}
              >
                <group.icon className={`h-[18px] w-[18px] shrink-0 ${current === group.board ? "text-sidebar-active-foreground" : "text-sidebar-muted"}`} aria-hidden="true" />
                {group.label}
              </Link>
            )}
          </div>
        ))}

        <div className="flex items-center gap-3 px-3 pt-2">
          {arranging ? (
            <>
              <button
                type="button"
                onClick={() => setArranging(false)}
                className="cursor-pointer rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
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
                className="cursor-pointer text-xs text-sidebar-muted hover:text-sidebar-strong hover:underline disabled:cursor-default disabled:opacity-40 disabled:hover:no-underline"
              >
                Reset order
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setArranging(true)} className="inline-flex cursor-pointer items-center gap-1 text-xs text-sidebar-muted hover:text-sidebar-foreground hover:underline">
              <ArrowUpDown className="h-3 w-3" aria-hidden="true" /> Reorder sections
            </button>
          )}
        </div>
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent-800">
            {initialsOf(displayName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sidebar-strong">{displayName}</p>
            <p className="truncate text-xs text-sidebar-muted">{roleLabel}</p>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/account/password" onClick={onNavigate} className="inline-flex items-center gap-1 text-xs text-sidebar-muted hover:text-sidebar-strong hover:underline">
            <KeyRound className="h-3 w-3" aria-hidden="true" /> Change password
          </Link>
          <Link href="/settings/appearance" onClick={onNavigate} className="inline-flex items-center gap-1 text-xs text-sidebar-muted hover:text-sidebar-strong hover:underline">
            <Palette className="h-3 w-3" aria-hidden="true" /> Appearance
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="text-xs text-sidebar-muted hover:text-sidebar-strong hover:underline">
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
