// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("next/link", () => ({
  default: ({ onClick, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      {...props}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
      }}
    />
  ),
}));
vi.mock("../actions", () => ({
  saveBoardLayout: vi.fn(async (input: { tiles: unknown[] }) => ({ ok: true, data: input.tiles })),
  resetBoardLayout: vi.fn(),
  applyLayoutPreset: vi.fn(),
  setHideClearTiles: vi.fn(async () => ({ ok: true, data: true })),
}));
vi.mock("../../tasks/actions", () => ({ completeTask: vi.fn(async () => {}), rescheduleTask: vi.fn(async () => ({ ok: true })) }));

import { availableWidgets } from "@/lib/boards/catalog";
import type { WidgetData } from "@/lib/boards/items";
import type { Tile } from "@/lib/boards/preferences";
import { DEFAULT_STYLE } from "@/lib/boards/style";
import { saveBoardLayout } from "../actions";
import { completeTask } from "../../tasks/actions";
import { BoardView } from "./BoardView";

beforeAll(() => {
  window.matchMedia = ((query: string) => ({ matches: query.includes("min-width"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const tiles: Tile[] = [
  { id: "tasks", widget: "tasksDue", size: "L", style: DEFAULT_STYLE },
  { id: "leads", widget: "newLeads", size: "M", style: DEFAULT_STYLE },
  { id: "review", widget: "emailsToReview", size: "M", style: DEFAULT_STYLE },
];
const data: Record<string, WidgetData> = {
  tasks: {
    tileId: "tasks",
    widget: "tasksDue",
    headline: { value: "2", label: "tasks" },
    total: 2,
    severity: "overdue",
    items: [
      { id: "task:t1", title: "Call the buyer", subtitle: null, due: "2026-10-27", dueLabel: "Overdue · Oct 27", severity: "overdue", href: "/tasks", actions: [{ kind: "completeTask", label: "Complete", taskId: "t1" }, { kind: "open", label: "Open", href: "/tasks" }] },
      { id: "task:t2", title: "Send invoice", subtitle: null, due: "2026-10-29", dueLabel: "Today", severity: "today", href: "/tasks", actions: [{ kind: "open", label: "Open", href: "/tasks" }] },
    ],
  },
  leads: { tileId: "leads", widget: "newLeads", headline: { value: "1", label: "new lead" }, total: 1, severity: "today", items: [{ id: "lead:l1", title: "Pat Doe", subtitle: null, due: null, dueLabel: "Added Today", severity: "today", href: "/leads/l1", actions: [] }] },
  review: { tileId: "review", widget: "emailsToReview", headline: { value: "0", label: "to review" }, total: 0, severity: null, items: [] },
};
const props = { board: "overview" as const, layout: { desktop: tiles, phone: null }, data, widgets: availableWidgets("OWNER_ADMIN"), hideClear: false, timeZone: "America/New_York", now: "2026-10-29T14:00:00Z" };
const tileEl = (id: string) => document.querySelector<HTMLElement>(`[data-tile="${id}"]`)!;
const order = () => [...document.querySelectorAll<HTMLElement>("[data-tile]")].map((el) => el.dataset.tile);

describe("board view", () => {
  it("shows urgent items with a fixed-color status word, and shrinks an empty tile to All clear", () => {
    render(<BoardView {...props} />);
    expect(within(tileEl("tasks")).getByText("Overdue")).toBeTruthy();
    expect(within(tileEl("tasks")).getByText("Call the buyer")).toBeTruthy();
    // Large tiles carry the item's main action inline.
    expect(within(tileEl("tasks")).getByRole("button", { name: "Complete" })).toBeTruthy();
    expect(within(tileEl("review")).getByText("All clear")).toBeTruthy();
    expect(tileEl("review").className).toContain("col-span-1");
  });

  it("hides empty tiles when asked", () => {
    render(<BoardView {...props} hideClear />);
    expect(order()).toEqual(["tasks", "leads"]);
  });

  it("opens a quick sheet with full-size actions that call the real task action", async () => {
    const user = userEvent.setup();
    render(<BoardView {...props} />);
    await user.click(within(tileEl("tasks")).getByRole("button", { name: /Tasks due/i }));
    expect(screen.getByRole("heading", { name: "Tasks due" })).toBeTruthy();
    // One Complete on the tile, one in the sheet.
    const completes = screen.getAllByRole("button", { name: "Complete" });
    expect(completes).toHaveLength(2);
    await user.click(completes[1]);
    await waitFor(() => expect(completeTask).toHaveBeenCalledWith("t1"));
    expect(refresh).toHaveBeenCalled();
  });

  it("edits: remove, resize, keyboard move, and saves once after a pause", async () => {
    const user = userEvent.setup();
    render(<BoardView {...props} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(tileEl("tasks").querySelector("article")!.className).toContain("animate-wiggle");

    await user.click(screen.getByRole("button", { name: /Resize New leads/ }));
    tileEl("leads").focus();
    await user.keyboard("{ArrowLeft}");
    expect(order()).toEqual(["leads", "tasks", "review"]);
    await user.click(screen.getByRole("button", { name: "Remove Emails to review" }));
    expect(order()).toEqual(["leads", "tasks"]);

    await waitFor(() => expect(saveBoardLayout).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const saved = vi.mocked(saveBoardLayout).mock.calls[0][0] as { board: string; device: string; tiles: Tile[] };
    expect(saved.board).toBe("overview");
    expect(saved.device).toBe("desktop");
    expect(saved.tiles.map((t) => [t.id, t.size])).toEqual([
      ["leads", "L"],
      ["tasks", "L"],
    ]);
  });

  it("adds a widget from the gallery, this board's suggestions first", async () => {
    const user = userEvent.setup();
    render(<BoardView {...props} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getAllByRole("button", { name: /Add widget/ })[0]);
    const suggested = screen.getByRole("heading", { name: "Suggested here" }).parentElement!;
    expect(within(suggested).getByText("Focus deck")).toBeTruthy();
    const nextUp = within(suggested).getByText("Next up").closest("li")!;
    await user.click(within(nextUp).getByRole("button", { name: "Add" }));
    expect(order()).toHaveLength(4);
    await waitFor(() => expect(saveBoardLayout).toHaveBeenCalled(), { timeout: 2000 });
    // The new tile's data comes with a refresh.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("restyles a tile: color, fill and shape", async () => {
    const user = userEvent.setup();
    render(<BoardView {...props} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Style New leads" }));
    await user.click(screen.getByRole("button", { name: "Violet" }));
    await user.click(screen.getByRole("radio", { name: "Bold fill" }));
    await user.click(screen.getByRole("radio", { name: "Rounded" }));
    await act(async () => {});
    const article = tileEl("leads").querySelector("article")!;
    expect(article.style.borderRadius).toBe("12px");
    expect(article.style.background).toMatch(/oklch|rgb/);
    await waitFor(() => expect(saveBoardLayout).toHaveBeenCalled(), { timeout: 2000 });
    const saved = vi.mocked(saveBoardLayout).mock.calls.at(-1)![0] as { tiles: Tile[] };
    expect(saved.tiles.find((t) => t.id === "leads")!.style).toEqual({ color: "violet", fill: "bold", shape: "rounded", density: "comfortable" });
  });
});
