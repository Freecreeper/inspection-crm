// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
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
vi.mock("../calendar/actions", () => ({ createCustomerQuick: vi.fn() }));

import { NewMenu } from "./NewMenu";

afterEach(cleanup);

describe("+ New respects RBAC", () => {
  it("office staff see every create action", async () => {
    const user = userEvent.setup();
    render(<NewMenu canSchedule canWriteCrm canAddTask onAction={() => {}} />);
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "New customer",
      "New lead",
      "New transaction",
      "Schedule inspection",
      "New realtor",
      "New brokerage",
      "New property",
      "New task",
    ]);
  });

  it("roles that can't create anything get no menu at all", () => {
    const { container } = render(<NewMenu canSchedule={false} canWriteCrm={false} canAddTask={false} onAction={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("dialog actions hand off to the shell", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<NewMenu canSchedule canWriteCrm={false} canAddTask={false} onAction={onAction} />);
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    await user.click(screen.getByRole("menuitem", { name: "Schedule inspection" }));
    expect(onAction).toHaveBeenCalledWith("schedule");
  });
});

describe("+ New links", () => {
  it("opens the existing create forms, so their validation applies", async () => {
    const user = userEvent.setup();
    render(<NewMenu canSchedule canWriteCrm canAddTask onAction={() => {}} />);
    await user.click(screen.getByRole("button", { name: "New" }));
    const href = (name: string) => screen.getByRole("menuitem", { name }).getAttribute("href");
    expect(href("New lead")).toBe("/leads#new-lead");
    expect(href("New transaction")).toBe("/transactions/new");
    expect(href("New realtor")).toBe("/realtors?new=1");
    expect(href("New property")).toBe("/properties#new-property");
  });
});
