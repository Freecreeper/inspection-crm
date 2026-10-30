// The app's sections: each sidebar title opens its board, and the pages in
// it are reached from that board's page chips (and global search). Shared by
// the sidebar and the boards so they can't disagree. `requires` hides a page
// from roles that can't use it (the page itself still enforces it).

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
  UserCog,
  Package,
  LayoutTemplate,
  MessagesSquare,
  Wrench,
  SlidersHorizontal,
  FileSignature,
  Palette,
} from "lucide-react";
import type { Permission } from "@/lib/rbac";
import { BOARD_HREF, type BoardId } from "@/lib/boards/catalog";

export type NavItem = { href: string; label: string; icon: LucideIcon; requires?: Permission };
export interface NavGroup {
  label: string;
  board: BoardId;
  href: string;
  icon: LucideIcon;
  items: NavItem[];
}

// Grouped by kind of work: the inspection side (jobs, what's offered, what
// goes into reports) is kept apart from the relationship side (Realtors,
// brokerages, referrals, follow-up tasks).
export const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", board: "overview", href: BOARD_HREF.overview, icon: LayoutDashboard, items: [{ href: "/calendar", label: "Calendar", icon: CalendarDays }] },
  {
    label: "Inspections",
    board: "inspections",
    href: BOARD_HREF.inspections,
    icon: MapPin,
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
    board: "relationships",
    href: BOARD_HREF.relationships,
    icon: Contact,
    items: [
      { href: "/realtors", label: "Realtors", icon: Contact },
      { href: "/brokerages", label: "Brokerages", icon: Building2 },
      { href: "/referral-sources", label: "Referral sources", icon: Star },
      { href: "/tasks", label: "Tasks", icon: CheckSquare },
    ],
  },
  {
    label: "Clients & deals",
    board: "clients",
    href: BOARD_HREF.clients,
    icon: Users,
    items: [
      { href: "/leads", label: "Leads", icon: UserPlus },
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/transactions", label: "Transactions", icon: ArrowRightLeft },
      { href: "/properties", label: "Properties", icon: Home },
    ],
  },
  {
    label: "Communication",
    board: "communication",
    href: BOARD_HREF.communication,
    icon: MessagesSquare,
    items: [
      { href: "/email", label: "Email", icon: Send },
      { href: "/communications", label: "Communications", icon: Mail },
      { href: "/documents", label: "Documents", icon: FileText },
    ],
  },
  {
    label: "Tools",
    board: "tools",
    href: BOARD_HREF.tools,
    icon: Wrench,
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3, requires: "report-builder:use" },
      { href: "/settings/users", label: "Users", icon: UserCog, requires: "user:manage" },
      { href: "/settings/custom-fields", label: "Custom fields", icon: SlidersHorizontal, requires: "custom-field:manage" },
      { href: "/settings/agreement", label: "Agreement", icon: FileSignature, requires: "agreement:manage" },
      { href: "/settings/branding", label: "Branding", icon: Palette, requires: "branding:manage" },
    ],
  },
];

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// The sections a role sees: each with only its allowed pages; a section with
// none is hidden (Overview, the home board, always shows).
export function visibleGroups(granted: Permission[]): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.requires || granted.includes(i.requires)) })).filter((g) => g.board === "overview" || g.items.length > 0);
}

// The section a path belongs to: its board, or one of its pages.
export function groupForPath(pathname: string): NavGroup | undefined {
  return NAV_GROUPS.find((g) => isActivePath(pathname, g.href)) ?? NAV_GROUPS.find((g) => g.items.some((i) => isActivePath(pathname, i.href)));
}
