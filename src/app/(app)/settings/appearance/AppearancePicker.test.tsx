// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./actions", () => ({ saveThemePreference: vi.fn(async (t: unknown) => t) }));

import { saveThemePreference } from "./actions";
import { AppearancePicker } from "./AppearancePicker";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("data-appearance");
  document.documentElement.removeAttribute("data-palette");
  document.getElementById("custom-theme")?.remove();
});

describe("Appearance picker", () => {
  it("applies a choice at once and saves it once after a pause", async () => {
    const user = userEvent.setup();
    render(<AppearancePicker initial={{ appearance: "system", palette: "forest" }} />);
    await user.click(screen.getByLabelText(/^Dark/));
    await user.click(screen.getByLabelText("Coastal"));
    expect(document.documentElement.dataset.appearance).toBe("dark");
    expect(document.documentElement.dataset.palette).toBe("coastal");
    expect(document.cookie).toMatch(/crm-theme=dark:coastal@\d+/);
    await waitFor(() => expect(saveThemePreference).toHaveBeenCalledTimes(1));
    expect(saveThemePreference).toHaveBeenCalledWith({ appearance: "dark", palette: "coastal", savedAt: expect.any(Number) });
    expect(await screen.findByText("Saved to your account.")).toBeTruthy();
  });

  it("builds a custom theme from three choices and ignores an invalid color", async () => {
    const user = userEvent.setup();
    render(<AppearancePicker initial={{ appearance: "light", palette: "forest" }} />);
    await user.click(screen.getByLabelText("Custom"));
    expect(document.documentElement.dataset.palette).toBe("custom");
    expect(document.getElementById("custom-theme")?.textContent).toContain(':root[data-palette="custom"]');

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    const hex = screen.getByLabelText("Brand color hex");
    await user.clear(hex);
    await user.type(hex, "not-a-color");
    await user.tab();
    await waitFor(() => expect(saveThemePreference).toHaveBeenCalled());
    const last = vi.mocked(saveThemePreference).mock.calls.at(-1)![0] as { custom: { brand: string; sidebar: string } };
    expect(last.custom).toEqual({ brand: "#1f7a5a", neutral: "cool", sidebar: "dark" });
  });

  it("resets to System + Forest", async () => {
    const user = userEvent.setup();
    render(<AppearancePicker initial={{ appearance: "dark", palette: "earth" }} />);
    await user.click(screen.getByRole("button", { name: /Reset to default/ }));
    expect(document.documentElement.dataset.appearance).toBe("system");
    expect(document.documentElement.dataset.palette).toBe("forest");
    expect(screen.getByRole("button", { name: /Reset to default/ })).toHaveProperty("disabled", true);
  });
});
