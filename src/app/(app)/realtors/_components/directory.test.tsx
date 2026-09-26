// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
let currentSearch = "";
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const getRealtorPreview = vi.fn();
vi.mock("../actions", () => ({
  getRealtorPreview: (id: string) => getRealtorPreview(id),
  createRealtorTask: vi.fn(),
  logRealtorCommunication: vi.fn(),
  updateRealtorProfile: vi.fn(),
  createRealtorQuick: vi.fn(),
}));
vi.mock("../../tasks/actions", () => ({ completeTask: vi.fn(), rescheduleTask: vi.fn() }));
// The Add Realtor modal's brokerage picker imports its own server action;
// keep the real auth/database modules out of a browser-environment test.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { parseDirectoryParams } from "@/lib/realtors/directoryParams";
import { DirectoryToolbar, SEARCH_DEBOUNCE_MS } from "./DirectoryToolbar";
import { DirectoryView, type DirectoryRowView } from "./DirectoryView";
import { RealtorsHeader } from "./RealtorsHeader";
import { QuickActions } from "./QuickActions";

const row = (id: string, firstName: string, extra: Partial<DirectoryRowView> = {}): DirectoryRowView => ({
  id,
  firstName,
  lastName: "Test",
  preferredName: null,
  email: `${firstName.toLowerCase()}@x.test`,
  phone: "8285550101",
  active: true,
  brokerageId: "b1",
  brokerageName: "Keller Williams",
  transactionCount: 2,
  referralCount: 1,
  lastActivityAt: null,
  nextFollowUpAt: null,
  ...extra,
});

const preview = {
  id: "r1",
  displayName: "Ann Test",
  legalName: null,
  firstName: "Ann",
  lastName: "Test",
  preferredName: null,
  active: true,
  email: null,
  phone: "8285550101",
  preferredContactMethod: null,
  notes: null,
  brokerage: null,
  metrics: { associatedTransactions: 2, referrals: 1, customersReferred: 1, associatedRevenue: null, referralRevenue: null },
  nextAction: null,
  recentActivity: [],
  permissions: { canWrite: false, canViewFinancials: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  currentSearch = "";
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never;
  window.history.replaceState(null, "", "/realtors");
  getRealtorPreview.mockResolvedValue(preview);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("live search", () => {
  it("filters as you type, debounced, without pressing Enter", () => {
    vi.useFakeTimers();
    render(<DirectoryToolbar params={parseDirectoryParams({})} brokerages={[]} />);
    const input = screen.getByLabelText("Search realtors");

    for (const value of ["s", "sa", "sar", "sara", "sarah"]) {
      fireEvent.change(input, { target: { value } });
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS / 2);
      });
    }
    // Still typing — nothing sent yet.
    expect(router.replace).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/realtors?q=sarah", { scroll: false });
  });

  it("clearing the box removes the search and returns to page 1", () => {
    vi.useFakeTimers();
    currentSearch = "q=sarah&page=2";
    render(<DirectoryToolbar params={parseDirectoryParams({ q: "sarah", page: "2" })} brokerages={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(router.replace).toHaveBeenCalledWith("/realtors", { scroll: false });
  });
});

describe("filters", () => {
  it("applies a filter immediately and shows it as a removable chip", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DirectoryToolbar params={parseDirectoryParams({})} brokerages={[{ id: "b1", name: "Keller Williams" }]} />);

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.click(screen.getByRole("checkbox", { name: "Has referrals" }));
    expect(router.replace).toHaveBeenLastCalledWith("/realtors?hasReferrals=1", { scroll: false });

    await user.selectOptions(screen.getByLabelText("Brokerage"), "b1");
    expect(router.replace).toHaveBeenLastCalledWith("/realtors?brokerageId=b1", { scroll: false });

    currentSearch = "hasReferrals=1&brokerageId=b1";
    rerender(<DirectoryToolbar params={parseDirectoryParams({ hasReferrals: "1", brokerageId: "b1" })} brokerages={[{ id: "b1", name: "Keller Williams" }]} />);
    const chips = screen.getByRole("list", { name: "Active filters" });
    await user.click(within(chips).getByRole("button", { name: /Keller Williams/ }));
    expect(router.replace).toHaveBeenLastCalledWith("/realtors?hasReferrals=1", { scroll: false });
  });

  it("closes the filter panel with Escape", async () => {
    const user = userEvent.setup();
    render(<DirectoryToolbar params={parseDirectoryParams({})} brokerages={[]} />);
    await user.click(screen.getByRole("button", { name: /Filters/ }));
    expect(screen.getByRole("group", { name: "Filter realtors" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Filter realtors" })).toBeNull();
  });
});

describe("directory rows and drawer", () => {
  const rows = [row("r1", "Ann"), row("r2", "Ben"), row("r3", "Cal")];

  it("opens the preview drawer for the selected realtor without navigating away", async () => {
    const user = userEvent.setup();
    render(<DirectoryView rows={rows} total={3} params={parseDirectoryParams({})} initialSelectedId={null} />);

    const table = screen.getByRole("table");
    await user.click(within(table).getByRole("button", { name: "Ben Test" }));

    expect(getRealtorPreview).toHaveBeenCalledWith("r2");
    expect(await screen.findByRole("dialog", { name: "Ann Test" })).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?selected=r2");
    expect(within(table).getByRole("button", { name: "Ben Test" }).getAttribute("aria-current")).toBe("true");
  });

  it("supports arrow-key navigation between rows", async () => {
    const user = userEvent.setup();
    render(<DirectoryView rows={rows} total={3} params={parseDirectoryParams({})} initialSelectedId={null} />);
    const table = screen.getByRole("table");
    within(table).getByRole("button", { name: "Ann Test" }).focus();

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Ben Test");
    await user.keyboard("{End}");
    expect(document.activeElement?.textContent).toBe("Cal Test");
    await user.keyboard("{ArrowUp}{Enter}");
    expect(getRealtorPreview).toHaveBeenCalledWith("r2");
  });

  it("closes with Escape and returns focus to the realtor's row", async () => {
    const user = userEvent.setup();
    render(<DirectoryView rows={rows} total={3} params={parseDirectoryParams({})} initialSelectedId={null} />);
    const button = within(screen.getByRole("table")).getByRole("button", { name: "Ann Test" });
    await user.click(button);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.search).toBe("");
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("shows sort state on the column header", () => {
    render(<DirectoryView rows={rows} total={3} params={parseDirectoryParams({ sort: "referrals" })} initialSelectedId={null} />);
    const header = screen.getAllByRole("columnheader").find((th) => th.textContent?.includes("Referrals"))!;
    expect(header.getAttribute("aria-sort")).toBe("descending");
  });

  it("offers pagination only when there's more to see", () => {
    render(<DirectoryView rows={rows} total={60} params={parseDirectoryParams({})} initialSelectedId={null} />);
    expect(screen.getByText("Showing 1–25 of 60")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe("/realtors?page=2");
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
  });
});

describe("Directory / Follow-up switch", () => {
  it("marks the current view and links to the other over the same data", () => {
    const { rerender } = render(<RealtorsHeader view="directory" brokerages={[]} canWrite={false} />);
    expect(screen.getByRole("link", { name: "Directory" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Follow-up" }).getAttribute("href")).toBe("/realtors?view=followup");
    expect(screen.queryByRole("button", { name: "+ Add Realtor" })).toBeNull();

    rerender(<RealtorsHeader view="followup" brokerages={[]} canWrite />);
    expect(screen.getByRole("link", { name: "Follow-up" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "+ Add Realtor" })).toBeTruthy();
  });
});

describe("QuickActions", () => {
  it("a missing email disables only the Email action", () => {
    render(<QuickActions realtorId="r1" phone="8285550101" email={null} canWrite onChanged={() => {}} />);
    expect(screen.getByText("Email not provided")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Email" })).toBeNull();
    expect(screen.getByRole("link", { name: "Call" }).getAttribute("href")).toBe("tel:8285550101");
    expect(screen.getByRole("button", { name: "Task" })).toBeTruthy();
  });

  it("hides write actions from read-only roles", async () => {
    const user = userEvent.setup();
    render(<QuickActions realtorId="r1" phone={null} email="a@b.test" canWrite={false} onChanged={() => {}} />);
    expect(screen.queryByRole("button", { name: "Task" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: "New transaction" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Relationship analytics" })).toBeTruthy();
  });
});
