// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
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

import { AppSidebar } from "./AppSidebar";

afterEach(() => {
  cleanup();
  pathname = "/realtors";
  document.body.style.overflow = "";
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

describe("navigation groups", () => {
  const groupLinks = (label: string) => {
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0];
    const heading = within(nav).getByText(label, { selector: "p" });
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
});
