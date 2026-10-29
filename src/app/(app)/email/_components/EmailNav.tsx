"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/email", label: "Messages", exact: true },
  { href: "/email/review", label: "Needs review" },
  { href: "/email/automations", label: "Automations" },
  { href: "/email/campaigns", label: "Campaigns" },
  { href: "/email/templates", label: "Templates" },
  { href: "/email/settings", label: "Settings" },
];

export function EmailNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Email sections" className="mt-5 flex gap-1 overflow-x-auto border-b border-neutral-200">
      {LINKS.map((l) => {
        const active = l.exact ? pathname === l.href || pathname.startsWith("/email/messages") : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              active ? "border-neutral-900 text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
