// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { useState } from "react";
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
vi.mock("../../calendar/actions", () => ({ createCustomerQuick: vi.fn() }));

import { defaultPreferences, visibleWidgets, type DashboardPreferences } from "@/lib/dashboard/preferences";
import { KPI_LIMIT, OPTIONAL_ATTENTION, REQUIRED_ATTENTION, availableKpis, availableWidgets } from "@/lib/dashboard/registry";
import { CustomizePanel } from "./CustomizePanel";
import { NewMenu } from "./NewMenu";

beforeAll(() => {
  // The shared Drawer asks whether the screen is wide.
  window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe("+ New respects RBAC", () => {
  it("office staff see every create action", async () => {
    const user = userEvent.setup();
    render(<NewMenu canSchedule canWriteCrm canAddTask onAction={() => {}} />);
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Schedule inspection",
      "New customer",
      "New realtor",
      "New transaction",
      "New lead",
      "New task",
    ]);
  });

  it("roles that can't create anything get no menu at all", () => {
    const { container } = render(<NewMenu canSchedule={false} canWriteCrm={false} canAddTask={false} onAction={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("dialog actions hand off to the Dashboard", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<NewMenu canSchedule canWriteCrm={false} canAddTask={false} onAction={onAction} />);
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    await user.click(screen.getByRole("menuitem", { name: "Schedule inspection" }));
    expect(onAction).toHaveBeenCalledWith("schedule");
  });
});

function Harness({ initial = defaultPreferences("OWNER_ADMIN"), onRestore = async () => {} }: { initial?: DashboardPreferences; onRestore?: () => Promise<void> }) {
  const [prefs, setPrefs] = useState(initial);
  return (
    <>
      <output data-testid="order">{visibleWidgets(prefs).join(",")}</output>
      <output data-testid="kpis">{prefs.kpis.join(",")}</output>
      <CustomizePanel
        open
        onClose={() => {}}
        prefs={prefs}
        defaults={defaultPreferences("OWNER_ADMIN")}
        widgets={availableWidgets("OWNER_ADMIN")}
        kpis={availableKpis("OWNER_ADMIN")}
        attention={{ required: REQUIRED_ATTENTION.map((c) => ({ key: c.key, label: c.label })), optional: OPTIONAL_ATTENTION.map((c) => ({ key: c.key, label: c.label })) }}
        status={{ kind: "idle" }}
        onChange={setPrefs}
        onRestore={onRestore}
        onRetry={() => {}}
        onUndo={() => {}}
      />
    </>
  );
}

describe("Customize Dashboard", () => {
  it("widgets reorder with keyboard-accessible Move up / Move down buttons (not only drag)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const moveUp = screen.getByRole("button", { name: "Move Upcoming up" });
    moveUp.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("order").textContent).toBe("today,needsAttention,upcoming,snapshot,recentActivity");
    await user.click(screen.getByRole("button", { name: "Move Recent Activity up" }));
    expect(screen.getByTestId("order").textContent).toBe("today,needsAttention,upcoming,recentActivity,snapshot");
    // The move is announced for screen readers.
    expect(screen.getByText("Recent Activity moved to position 4 of 10.")).toBeTruthy();
    // The first row can't move further up.
    expect((screen.getByRole("button", { name: "Move Today up" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("widgets can be hidden and shown with a checkbox", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: /Recent Activity/ }));
    expect(screen.getByTestId("order").textContent).not.toContain("recentActivity");
    await user.click(screen.getByRole("checkbox", { name: /Lead Activity/ }));
    expect(screen.getByTestId("order").textContent).toContain("leadActivity");
  });

  it(`KPIs: remove one, add another, and no more than ${KPI_LIMIT}`, async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "Avg inspection value" }));
    await user.click(screen.getByRole("checkbox", { name: "Outstanding balance" }));
    expect(screen.getByTestId("kpis").textContent).toBe("inspectionsMonth,revenueMonth,referralsMonth,outstandingBalance");
    await user.click(screen.getByRole("checkbox", { name: "Unpaid invoices" }));
    await user.click(screen.getByRole("checkbox", { name: "New leads this month" }));
    expect(screen.getByTestId("kpis").textContent?.split(",")).toHaveLength(KPI_LIMIT);
    const kpiSection = screen.getByRole("region", { name: "Business Snapshot KPIs" });
    const overflow = within(kpiSection).getByRole("checkbox", { name: "Overdue tasks" }) as HTMLInputElement;
    expect(overflow.disabled).toBe(true);
    expect(screen.getByText(/remove one to add another/)).toBeTruthy();
  });

  it("required attention is listed but can't be switched off; optional categories can", () => {
    render(<Harness />);
    const section = within(screen.getByRole("region", { name: "Needs Attention" }));
    expect(section.getByText("Scheduling conflicts")).toBeTruthy();
    expect(section.queryByRole("checkbox", { name: "Scheduling conflicts" })).toBeNull();
    expect(section.getByRole("checkbox", { name: "Overdue tasks" })).toBeTruthy();
    expect(section.getByRole("checkbox", { name: "Realtor follow-ups due" })).toBeTruthy();
  });

  it("restoring the default asks first when it would discard customization", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn(async () => {});
    const custom = { ...defaultPreferences("OWNER_ADMIN"), kpis: ["newLeadsMonth"] as DashboardPreferences["kpis"] };
    render(<Harness initial={custom} onRestore={onRestore} />);
    await user.click(screen.getByRole("button", { name: "Restore Default Dashboard" }));
    expect(onRestore).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Restore default" }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("with the default layout there is nothing to restore", () => {
    render(<Harness />);
    expect(screen.getByText("You're using the default layout for your role.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore Default Dashboard" })).toBeNull();
  });
});
