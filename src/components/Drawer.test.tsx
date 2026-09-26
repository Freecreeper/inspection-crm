// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Drawer } from "./Drawer";

function mockViewport(wide: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: wide, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never;
}

beforeEach(() => mockViewport(true));
afterEach(cleanup);

describe("Drawer", () => {
  it("renders nothing when closed", () => {
    render(
      <Drawer open={false} onClose={() => {}} title="Sarah Jones" titleId="t">
        body
      </Drawer>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens as a labelled dialog and moves focus to its title", () => {
    render(
      <Drawer open onClose={() => {}} title="Sarah Jones" titleId="t">
        body
      </Drawer>
    );
    const dialog = screen.getByRole("dialog", { name: "Sarah Jones" });
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Sarah Jones" }));
  });

  it("closes with the close button and with Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Drawer open onClose={onClose} title="Sarah Jones" titleId="t">
        body
      </Drawer>
    );
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("lets an inner control consume Escape first", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Drawer open onClose={onClose} title="Sarah Jones" titleId="t">
        <input aria-label="inner" onKeyDown={(e) => e.key === "Escape" && e.preventDefault()} />
      </Drawer>
    );
    await user.click(screen.getByLabelText("inner"));
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("becomes a modal sheet with a backdrop on narrow screens", async () => {
    mockViewport(false);
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <Drawer open onClose={onClose} title="Sarah Jones" titleId="t">
        body
      </Drawer>
    );
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    await user.click(container.querySelector('[aria-hidden="true"]')!);
    expect(onClose).toHaveBeenCalled();
  });

  it("returns focus to whatever opened it", async () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button>row</button>
          <Drawer open={open} onClose={() => {}} title="Sarah Jones" titleId="t">
            body
          </Drawer>
        </>
      );
    }
    const { rerender } = render(<Harness open={false} />);
    screen.getByRole("button", { name: "row" }).focus();
    rerender(<Harness open />);
    expect(document.activeElement?.textContent).toBe("Sarah Jones");
    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "row" }));
  });
});
