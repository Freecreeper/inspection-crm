import Link from "next/link";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PERMISSIONS, can, type Permission } from "@/lib/rbac";
import { getCalendarConfig } from "@/lib/calendar/config";
import { formatDay, toDayKey, zonedParts } from "@/lib/calendar/time";
import { BOARD_LABELS, availableWidgets, type BoardId } from "@/lib/boards/catalog";
import { defaultLayout, resolveBoardPreferences } from "@/lib/boards/preferences";
import { loadBoard } from "@/lib/boards/service";
import { NAV_GROUPS, visibleGroups } from "../navigation";
import { BoardView } from "./_components/BoardView";

const PURPOSE: Record<BoardId, string> = {
  overview: "",
  inspections: "Today's jobs, reports to finish, and what's coming up.",
  relationships: "Follow-ups due and realtors who need a next step.",
  clients: "New leads, stalled deals, and deadlines.",
  communication: "Emails to review, failures, and what's about to send.",
  tools: "Account housekeeping.",
};

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// One title board: only urgent and immediately upcoming work, laid out the
// way the user arranged it (or the board's preset). Rendered per request,
// so it changes through the day as work is done.
export async function BoardPage({ board }: { board: BoardId }) {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  const userId = session?.user?.id;
  if (!role || !userId || !can(role, "dashboard:view")) {
    return <p className="text-sm text-neutral-600">You don&apos;t have access to this board.</p>;
  }

  const granted = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, dashboardPreferences: true } });
  const prefs = resolveBoardPreferences(user?.dashboardPreferences, role);
  const now = new Date();
  const data = await loadBoard({ userId, role }, board, prefs, now);
  const { timeZone } = getCalendarConfig();
  const layout = prefs.boards[board] ?? defaultLayout(board, role);
  // The pages in this section, always one click away (they can't be hidden).
  const pages = board === "overview" ? [] : (visibleGroups(granted).find((g) => g.board === board)?.items ?? []);
  const firstName = user?.name?.split(" ")[0] ?? null;
  const overviewPages = board === "overview" ? (NAV_GROUPS.find((g) => g.board === "overview")?.items ?? []) : [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {board === "overview" ? (
            <>
              <p className="text-sm text-muted-foreground">
                {greetingFor(zonedParts(now, timeZone).hour)}
                {firstName ? `, ${firstName}` : ""}
              </p>
              <h1 className="text-2xl font-semibold text-foreground">{formatDay(toDayKey(now, timeZone), "long")}</h1>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-foreground">{BOARD_LABELS[board]}</h1>
              <p className="text-sm text-muted-foreground">{PURPOSE[board]}</p>
            </>
          )}
        </div>
      </header>

      {[...pages, ...overviewPages].length > 0 && (
        <nav aria-label={`${BOARD_LABELS[board]} pages`} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {[...pages, ...overviewPages].map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-medium text-neutral-700 hover:border-input hover:bg-hover"
            >
              <p.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {p.label}
            </Link>
          ))}
        </nav>
      )}

      <BoardView
        board={board}
        layout={layout}
        data={data}
        widgets={availableWidgets(role)}
        hideClear={prefs.hideClear}
        timeZone={timeZone}
        now={now.toISOString()}
      />
    </div>
  );
}
