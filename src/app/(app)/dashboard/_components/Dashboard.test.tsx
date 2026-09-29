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
vi.mock("../../email/actions", () => ({ retryEmail: vi.fn(async () => ({ ok: true, data: { status: "QUEUED" } })), discardDraft: vi.fn(async () => ({ ok: true, data: undefined })) }));
vi.mock("../../tasks/actions", () => ({ completeTask: vi.fn(async () => {}), rescheduleTask: vi.fn(async () => ({ ok: true })) }));
// The real composer loads recipients from the server; the widget only needs
// to hand it the right draft/context.
vi.mock("@/components/email/EmailComposer", () => ({
  EmailButton: ({ label = "Email", draftId, context }: { label?: string; draftId?: string; context: { kind: string; id: string } }) => (
    <button type="button" data-draft={draftId ?? ""} data-context={`${context.kind}:${context.id}`}>
      {label}
    </button>
  ),
}));

import { defaultPreferences, visibleWidgets, type DashboardPreferences } from "@/lib/dashboard/preferences";
import { KPI_LIMIT, OPTIONAL_ATTENTION, REQUIRED_ATTENTION, availableKpis, availableWidgets } from "@/lib/dashboard/registry";
import { CustomizePanel } from "./CustomizePanel";
import { ActionQueueWidget } from "./widgets";
import { discardDraft, retryEmail } from "../../email/actions";
import { completeTask, rescheduleTask } from "../../tasks/actions";
import type { WidgetData } from "@/lib/dashboard/types";
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
    expect(screen.getByTestId("order").textContent).toBe("today,needsAttention,actionQueue,upcoming,snapshot,recentActivity");
    await user.click(screen.getByRole("button", { name: "Move Recent Activity up" }));
    expect(screen.getByTestId("order").textContent).toBe("today,needsAttention,actionQueue,upcoming,recentActivity,snapshot");
    // The move is announced for screen readers.
    expect(screen.getByText("Recent Activity moved to position 5 of 6.")).toBeTruthy();
    // The first row can't move further up.
    expect((screen.getByRole("button", { name: "Move Today up" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("widgets can be hidden and shown with a checkbox", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: /Recent Activity/ }));
    expect(screen.getByTestId("order").textContent).not.toContain("recentActivity");
    // Hidden widgets sit in their own list; ticking one adds it to the end.
    const hiddenList = screen.getByRole("list", { name: "Hidden widgets" });
    expect(within(hiddenList).getByRole("checkbox", { name: /Recent Activity/ })).toBeTruthy();
    await user.click(within(hiddenList).getByRole("checkbox", { name: /Lead Activity/ }));
    expect(screen.getByTestId("order").textContent).toBe("today,needsAttention,actionQueue,snapshot,upcoming,leadActivity");
    const shownList = screen.getByRole("list", { name: "Shown widgets, in order" });
    expect(within(shownList).getByRole("button", { name: "Move Lead Activity up" })).toBeTruthy();
    // Hidden widgets have no move buttons — nothing to reorder invisibly.
    expect(screen.queryByRole("button", { name: "Move Recent Activity up" })).toBeNull();
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

describe("Email & Task Actions widget", () => {
  const data: Extract<WidgetData, { key: "actionQueue" }> = {
    key: "actionQueue",
    emailTotal: 3,
    emails: [
      { id: "f1", kind: "failed", subject: "Your inspection is confirmed", recipientName: "Ava Chen", detail: "Provider timeout", at: "2026-09-28T12:00:00.000Z", context: { kind: "inspection", id: "i1" }, href: "/email/messages/f1" },
      { id: "b1", kind: "bounced", subject: "Reminder", recipientName: "Bo Lee", detail: "Hard bounce", at: "2026-09-28T12:00:00.000Z", context: { kind: "customer", id: "c2" }, href: "/email/messages/b1" },
      { id: "d1", kind: "review", subject: "Thanks for the referral", recipientName: "Sally Jones", detail: "Realtor thank-you", at: "2026-09-27T12:00:00.000Z", context: { kind: "realtor", id: "r1" }, href: "/email/messages/d1" },
    ],
    taskTotal: 1,
    tasks: [
      { id: "t1", title: "Follow up on listing", due: "2026-09-26", overdue: true, assigneeName: "Admin", context: "Sally Jones", href: "/realtors/r1", realtor: { id: "r1", name: "Sally Jones", phone: "8285550101" }, realtorEmail: true },
    ],
  };
  const renderWidget = (over: Partial<Parameters<typeof ActionQueueWidget>[0]> = {}) => {
    const props = { data, today: "2026-09-29", timeZone: "America/New_York", scope: "all" as const, canUpdateTasks: true, canSendEmail: true, onAddTask: vi.fn(), onOpen: vi.fn(), onChanged: vi.fn(), ...over };
    render(<ActionQueueWidget {...props} />);
    return props;
  };

  it("a failed email can be retried in place", async () => {
    const user = userEvent.setup();
    const props = renderWidget();
    await user.click(screen.getByRole("button", { name: "Retry: Your inspection is confirmed" }));
    expect(retryEmail).toHaveBeenCalledWith("f1");
    expect(await screen.findByText("Queued to send again.")).toBeTruthy();
    expect(props.onChanged).toHaveBeenCalled();
  });

  it("a bounced email links to the message (the address needs fixing, not a retry)", () => {
    renderWidget();
    expect(screen.getByRole("link", { name: "Review: Reminder" }).getAttribute("href")).toBe("/email/messages/b1");
    expect(screen.queryByRole("button", { name: /Retry: Reminder/ })).toBeNull();
  });

  it("a draft opens in the composer to review and send; discarding asks first", async () => {
    const user = userEvent.setup();
    renderWidget();
    const review = screen.getByRole("button", { name: "Review & send" });
    expect(review.getAttribute("data-draft")).toBe("d1");
    expect(review.getAttribute("data-context")).toBe("realtor:r1");
    await user.click(screen.getByRole("button", { name: "Discard: Thanks for the referral" }));
    expect(discardDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(discardDraft).toHaveBeenCalledWith("d1");
  });

  it("tasks can be completed, rescheduled, called, and emailed", async () => {
    const user = userEvent.setup();
    renderWidget();
    await user.click(screen.getByRole("button", { name: 'Mark "Follow up on listing" complete' }));
    expect(completeTask).toHaveBeenCalledWith("t1");
    await user.click(screen.getByRole("button", { name: "Reschedule: Follow up on listing" }));
    const date = screen.getByLabelText("New due date for Follow up on listing");
    await user.type(date, "2026-10-02");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(rescheduleTask).toHaveBeenCalledWith("t1", "2026-10-02");
    expect(screen.getByRole("link", { name: "Call Sally Jones" }).getAttribute("href")).toBe("tel:8285550101");
    expect(screen.getByRole("button", { name: "Email" }).getAttribute("data-context")).toBe("realtor:r1");
  });

  it("actions follow permissions: no send → Open links only; no task:update → no Complete/Reschedule/Add task", () => {
    renderWidget({ canSendEmail: false, canUpdateTasks: false });
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review & send" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Discard/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Open" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /complete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reschedule/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add task/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Email" })).toBeNull();
  });

  it("without email access there is no email section at all", () => {
    renderWidget({ data: { ...data, emails: null, emailTotal: 0 } });
    expect(screen.queryByRole("region", { name: "Emails" })).toBeNull();
    expect(screen.getByRole("region", { name: /Tasks due/ })).toBeTruthy();
  });
});
