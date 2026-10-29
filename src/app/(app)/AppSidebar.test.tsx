// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let pathname = "/realtors";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
// jsdom can't navigate; a plain anchor that just runs the click handler.
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

import { AppSidebar, moveLabel, orderGroups } from "./AppSidebar";

afterEach(() => {
  cleanup();
  pathname = "/realtors";
  document.body.style.overflow = "";
  localStorage.clear();
});

const renderSidebar = () =>
  render(
    <AppSidebar displayName="Admin Owner" roleLabel="Owner Admin" signOutAction={async () => {}}>
      <p>Page content</p>
    </AppSidebar>
  );

describe("mobile sidebar", () => {
  it("is closed until the menu button opens it, then traps focus and locks page scroll", async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(screen.queryByRole("dialog", { name: "Main menu" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("dialog", { name: "Main menu" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close menu" }));
    expect(document.body.style.overflow).toBe("hidden");
    expect(menu.querySelector('a[aria-current="page"]')?.textContent).toBe("Realtors");

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(menu.contains(document.activeElement)).toBe(true);
  });

  it("Escape closes it and returns focus to the menu button", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Main menu" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open menu" }));
    expect(document.body.style.overflow).toBe("");
  });

  it("closes when a page is picked or the route changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderSidebar();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.click(screen.getByRole("dialog", { name: "Main menu" }).querySelector<HTMLAnchorElement>('a[href="/brokerages"]')!);
    expect(screen.queryByRole("dialog", { name: "Main menu" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    pathname = "/customers";
    act(() => {
      rerender(
        <AppSidebar displayName="Admin Owner" roleLabel="Owner Admin" signOutAction={async () => {}}>
          <p>Page content</p>
        </AppSidebar>
      );
    });
    expect(screen.queryByRole("dialog", { name: "Main menu" })).toBeNull();
  });
});

describe("back to dashboard", () => {
  const topBar = () => screen.getByRole("main").previousElementSibling as HTMLElement;

  it("shows a Dashboard link in the top bar on every other page", () => {
    renderSidebar();
    expect(within(topBar()).getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/dashboard");
  });

  it("shows the app name instead on the dashboard itself", () => {
    pathname = "/dashboard";
    renderSidebar();
    expect(within(topBar()).queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(within(topBar()).getByText("Inspection CRM")).toBeTruthy();
  });
});

describe("desktop sidebar collapse", () => {
  it("collapses to an icon rail, remembered, and restores a saved collapse without animating", async () => {
    localStorage.setItem("sidebar-collapsed", "true");
    const user = userEvent.setup();
    const { container } = renderSidebar();
    const aside = container.querySelector("aside")!;
    expect(aside.className).toContain("w-16");
    expect(aside.className).not.toContain("transition-");
    // Every page is still one click away, named for screen readers.
    const rail = within(aside).getByRole("navigation", { name: "Main" });
    expect(within(rail).getByRole("link", { name: "Realtors" }).getAttribute("aria-current")).toBe("page");
    expect(within(rail).getByRole("list", { name: "Clients & deals" })).toBeTruthy();

    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(aside.className).toContain("w-64");
    expect(aside.className).toContain("transition-[width]");
    expect(within(aside).getByRole("button", { name: "Reorder sections" })).toBeTruthy();
    expect(localStorage.getItem("sidebar-collapsed")).toBe("false");

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(aside.className).toContain("w-16");
  });

  it("shows each rail icon's name in a tooltip on hover and keyboard focus", async () => {
    localStorage.setItem("sidebar-collapsed", "true");
    const user = userEvent.setup();
    const { container } = renderSidebar();
    const rail = within(container.querySelector("aside")!);
    await user.hover(rail.getByRole("link", { name: "Brokerages" }));
    expect(screen.getByText("Brokerages", { selector: "span[aria-hidden]" })).toBeTruthy();
    await user.unhover(rail.getByRole("link", { name: "Brokerages" }));
    expect(screen.queryByText("Brokerages", { selector: "span[aria-hidden]" })).toBeNull();

    rail.getByRole("link", { name: "Tasks" }).focus();
    await act(async () => {});
    expect(screen.getByText("Tasks", { selector: "span[aria-hidden]" })).toBeTruthy();
  });

  it("hides rail links the role can't use", () => {
    localStorage.setItem("sidebar-collapsed", "true");
    const { container } = renderSidebar();
    const rail = within(container.querySelector("aside")!);
    expect(rail.queryByRole("link", { name: "Invoices" })).toBeNull();
    expect(rail.queryByRole("list", { name: "Tools" })).toBeNull();
  });
});

describe("navigation groups", () => {
  const groupLinks = (label: string) => {
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0];
    const heading = within(nav).getByText(label, { selector: "button" });
    return [...heading.parentElement!.querySelectorAll("a")].map((a) => a.textContent?.trim());
  };

  it("keeps the inspection side apart from the realtor/brokerage side", () => {
    render(
      <AppSidebar displayName="Admin Owner" roleLabel="Owner Admin" granted={["financial:read", "report-builder:use", "user:manage"]} signOutAction={async () => {}}>
        <p>Page content</p>
      </AppSidebar>
    );
    expect(groupLinks("Inspections")).toEqual(["Inspections", "Services & Packages", "Report Templates", "Narratives", "Invoices"]);
    expect(groupLinks("Relationships")).toEqual(["Realtors", "Brokerages", "Referral sources", "Tasks"]);
    expect(groupLinks("Clients & deals")).toEqual(["Leads", "Customers", "Transactions", "Properties"]);
  });

  const desktopNav = () => screen.getAllByRole("navigation", { name: "Main" })[0];
  const groupToggle = (label: string) => within(desktopNav()).getByRole("button", { name: label });
  const linkVisible = (label: string) => within(desktopNav()).queryByRole("link", { name: label }) !== null;

  it("folds a group shut from its heading and remembers it", async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(groupToggle("Communication").getAttribute("aria-expanded")).toBe("true");
    expect(linkVisible("Email")).toBe(true);

    await user.click(groupToggle("Communication"));
    expect(groupToggle("Communication").getAttribute("aria-expanded")).toBe("false");
    expect(linkVisible("Email")).toBe(false);
    expect(linkVisible("Leads")).toBe(true);

    cleanup();
    renderSidebar();
    expect(linkVisible("Email")).toBe(false);
    await user.click(groupToggle("Communication"));
    expect(linkVisible("Email")).toBe(true);
    expect(JSON.parse(localStorage.getItem("sidebar-closed-groups")!)).toEqual([]);
  });

  it("animates folding, but not the folds restored on load", async () => {
    localStorage.setItem("sidebar-closed-groups", JSON.stringify(["Communication"]));
    const user = userEvent.setup();
    renderSidebar();
    const list = (label: string) => desktopNav().querySelector<HTMLElement>(`#${groupToggle(label).getAttribute("aria-controls")}`)!;
    expect(list("Communication").hasAttribute("inert")).toBe(true);
    expect(list("Communication").className).not.toContain("transition-");

    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await user.click(groupToggle("Clients & deals"));
    expect(list("Clients & deals").className).toContain("transition-");
    expect(list("Clients & deals").className).toContain("grid-rows-[0fr]");
    expect(list("Clients & deals").hasAttribute("inert")).toBe(true);
  });

  it("opens the group holding the current page, on load and on navigation", () => {
    localStorage.setItem("sidebar-closed-groups", JSON.stringify(["Relationships", "Clients & deals"]));
    const { rerender } = renderSidebar();
    expect(linkVisible("Realtors")).toBe(true);
    expect(linkVisible("Customers")).toBe(false);

    pathname = "/customers";
    act(() => {
      rerender(
        <AppSidebar displayName="Admin Owner" roleLabel="Owner Admin" signOutAction={async () => {}}>
          <p>Page content</p>
        </AppSidebar>
      );
    });
    expect(linkVisible("Customers")).toBe(true);
    expect(JSON.parse(localStorage.getItem("sidebar-closed-groups")!)).toEqual([]);
  });
});

describe("reordering groups", () => {
  const desktopNav = () => screen.getAllByRole("navigation", { name: "Main" })[0];
  const headingOrder = () =>
    [...desktopNav().querySelectorAll(":scope > div[draggable]")].map((el) => el.querySelector("button[aria-expanded], span")?.textContent?.trim());
  const DEFAULT = ["Overview", "Inspections", "Relationships", "Clients & deals", "Communication"];

  it("moves groups with the arrange-mode buttons, keeps focus on the moved group, and remembers the order", async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(headingOrder()).toEqual(DEFAULT);

    await user.click(within(desktopNav()).getByRole("button", { name: "Reorder sections" }));
    // Links are tucked away while arranging.
    expect(within(desktopNav()).queryByRole("link", { name: "Realtors" })).toBeNull();
    expect(within(desktopNav()).getByRole("button", { name: "Move Overview up" })).toHaveProperty("disabled", true);

    await user.click(within(desktopNav()).getByRole("button", { name: "Move Communication up" }));
    await user.click(within(desktopNav()).getByRole("button", { name: "Move Communication up" }));
    expect(headingOrder()).toEqual(["Overview", "Inspections", "Communication", "Relationships", "Clients & deals"]);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Move Communication up");

    await user.click(within(desktopNav()).getByRole("button", { name: "Done" }));
    expect(within(desktopNav()).getByRole("link", { name: "Realtors" })).toBeTruthy();

    cleanup();
    renderSidebar();
    expect(headingOrder()).toEqual(["Overview", "Inspections", "Communication", "Relationships", "Clients & deals"]);

    await user.click(within(desktopNav()).getByRole("button", { name: "Reorder sections" }));
    await user.click(within(desktopNav()).getByRole("button", { name: "Reset order" }));
    expect(headingOrder()).toEqual(DEFAULT);
    expect(localStorage.getItem("sidebar-group-order")).toBeNull();
  });

  it("rearranges live while dragging, saves on drop, and puts things back on a cancelled drag", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(within(desktopNav()).getByRole("button", { name: "Reorder sections" }));
    const groupEl = (label: string) => [...desktopNav().querySelectorAll(":scope > div[draggable]")].find((el) => el.querySelector("span")?.textContent === label)!;
    const dataTransfer = { effectAllowed: "", setData: () => {}, getData: () => "" };

    fireEvent.dragStart(groupEl("Overview"), { dataTransfer });
    // The dragged group stays in the list as a dashed placeholder.
    expect(groupEl("Overview").firstElementChild!.className).toContain("border-dashed");
    fireEvent.dragOver(groupEl("Relationships"), { dataTransfer });
    // Shown right away, not saved until the drop.
    expect(headingOrder()).toEqual(["Inspections", "Relationships", "Overview", "Clients & deals", "Communication"]);
    expect(localStorage.getItem("sidebar-group-order")).toBeNull();
    fireEvent.drop(groupEl("Relationships"), { dataTransfer });
    fireEvent.dragEnd(groupEl("Overview"), { dataTransfer });
    expect(headingOrder()).toEqual(["Inspections", "Relationships", "Overview", "Clients & deals", "Communication"]);
    expect(JSON.parse(localStorage.getItem("sidebar-group-order")!)).toEqual(["Inspections", "Relationships", "Overview", "Clients & deals", "Communication"]);
    expect(groupEl("Overview").firstElementChild!.className).not.toContain("border-dashed");

    fireEvent.dragStart(groupEl("Communication"), { dataTransfer });
    fireEvent.dragOver(groupEl("Inspections"), { dataTransfer });
    expect(headingOrder()).toEqual(["Communication", "Inspections", "Relationships", "Overview", "Clients & deals"]);
    // Let go outside the list: back to the saved order.
    fireEvent.dragEnd(groupEl("Communication"), { dataTransfer });
    expect(headingOrder()).toEqual(["Inspections", "Relationships", "Overview", "Clients & deals", "Communication"]);
  });

  it("drags a picture of only the grabbed heading", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(within(desktopNav()).getByRole("button", { name: "Reorder sections" }));
    const inspections = [...desktopNav().querySelectorAll(":scope > div[draggable]")].find((el) => el.querySelector("span")?.textContent === "Inspections")!;
    const setDragImage = vi.fn();
    fireEvent.dragStart(inspections, { dataTransfer: { effectAllowed: "", setData: () => {}, getData: () => "", setDragImage } });

    expect(setDragImage).toHaveBeenCalledTimes(1);
    const ghost = setDragImage.mock.calls[0][0] as HTMLElement;
    expect(ghost.textContent).toBe("Inspections");
    expect(ghost.parentElement).toBe(document.body);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(ghost.isConnected).toBe(false);
  });

  it("moves a dragged label into the target's place", () => {
    expect(moveLabel(["A", "B", "C"], "A", "C")).toEqual(["B", "C", "A"]);
    expect(moveLabel(["A", "B", "C"], "C", "A")).toEqual(["C", "A", "B"]);
    expect(moveLabel(["A", "B", "C"], "B", "B")).toEqual(["A", "B", "C"]);
  });

  it("keeps groups a saved order doesn't name in their default places after it", () => {
    const groups = ["A", "B", "C", "D"].map((label) => ({ label }));
    expect(orderGroups(groups, ["C", "A"]).map((g) => g.label)).toEqual(["C", "A", "B", "D"]);
    expect(orderGroups(groups, []).map((g) => g.label)).toEqual(["A", "B", "C", "D"]);
    expect(orderGroups(groups, ["Gone", "D"]).map((g) => g.label)).toEqual(["D", "A", "B", "C"]);
  });
});
