"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type LucideIcon,
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Circle,
  Clock,
  Contact,
  FileCheck2,
  FileText,
  Flag,
  Hourglass,
  KeyRound,
  Layers,
  Mail,
  MailX,
  MapPin,
  Phone,
  Receipt,
  Send,
  Signature,
  SquareStack,
  Star,
  UserPlus,
  UserX,
  Users,
} from "lucide-react";
import { telHref } from "@/lib/realtors/display";
import type { ItemAction, Severity } from "@/lib/boards/items";
import { completeTask, rescheduleTask } from "../../tasks/actions";

export const WIDGET_ICONS: Record<string, LucideIcon> = {
  alert: AlertTriangle,
  layers: Layers,
  clock: Clock,
  timeline: CalendarClock,
  stack: SquareStack,
  "map-pin": MapPin,
  calendar: CalendarDays,
  signature: Signature,
  file: FileText,
  "file-check": FileCheck2,
  send: Send,
  receipt: Receipt,
  check: CheckSquare,
  contact: Contact,
  "user-x": UserX,
  star: Star,
  "user-plus": UserPlus,
  hourglass: Hourglass,
  flag: Flag,
  users: Users,
  mail: Mail,
  "mail-x": MailX,
  key: KeyRound,
};

// Status always reads the same whatever a tile looks like: a fixed color,
// an icon and a word, so color is never the only cue.
const SEVERITY_STYLE: Record<Severity, { cls: string; icon: LucideIcon; label: string }> = {
  overdue: { cls: "border-danger-border bg-danger-soft text-danger-strong", icon: AlertCircle, label: "Overdue" },
  today: { cls: "border-warning-border bg-warning-soft text-warning-strong", icon: Clock, label: "Today" },
  soon: { cls: "border-info-border bg-info-soft text-info-strong", icon: CalendarClock, label: "Soon" },
  info: { cls: "border-border bg-surface text-muted-foreground", icon: Circle, label: "Open" },
};

export function SeverityBadge({ severity, count }: { severity: Severity; count?: number }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>
      <s.icon className="h-3 w-3" aria-hidden="true" />
      {count !== undefined ? `${count} ${s.label.toLowerCase()}` : s.label}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: Severity }) {
  const cls = { overdue: "bg-danger", today: "bg-warning", soon: "bg-info", info: "bg-neutral-300" }[severity];
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${cls}`} role="img" aria-label={SEVERITY_STYLE[severity].label} />;
}

// The current time, ticking each minute (starts from the server's "now" so
// the first render matches).
export function useNow(initial: string): Date {
  const [now, setNow] = useState(() => new Date(initial));
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// Runs an item's task actions through the existing task actions (which
// check permissions again), then refreshes the board.
export function useItemActions(onDone: (message: string) => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run(action: ItemAction) {
    if (action.kind === "completeTask") {
      start(async () => {
        try {
          await completeTask(action.taskId);
          onDone("Task completed.");
        } catch {
          onDone("Couldn't complete that task.");
        }
        router.refresh();
      });
    } else if (action.kind === "snoozeTask") {
      start(async () => {
        const result = await rescheduleTask(action.taskId, action.until).catch(() => ({ ok: false as const, error: "Couldn't move that task." }));
        onDone(result.ok ? "Moved to tomorrow." : result.error);
        router.refresh();
      });
    }
  }
  return { run, pending };
}

const actionCls = (primary: boolean) =>
  `inline-flex min-h-8 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
    primary ? "bg-primary text-primary-foreground hover:bg-primary-hover" : "border border-input bg-surface text-neutral-700 hover:bg-hover"
  }`;

export function ActionButton({ action, primary = false, run, pending }: { action: ItemAction; primary?: boolean; run: (a: ItemAction) => void; pending: boolean }) {
  switch (action.kind) {
    case "open":
      return (
        <Link href={action.href} className={actionCls(primary)}>
          {action.label}
        </Link>
      );
    case "call":
      return (
        <a href={telHref(action.phone)} className={actionCls(primary)}>
          <Phone className="h-3 w-3" aria-hidden="true" /> {action.label}
        </a>
      );
    case "email":
      return (
        <a href={`mailto:${action.email}`} className={actionCls(primary)}>
          <Mail className="h-3 w-3" aria-hidden="true" /> {action.label}
        </a>
      );
    default:
      return (
        <button type="button" disabled={pending} onClick={() => run(action)} className={actionCls(primary)}>
          {action.label}
        </button>
      );
  }
}
