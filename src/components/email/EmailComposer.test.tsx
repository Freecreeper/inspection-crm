// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/email/actions", () => ({
  getComposerData: vi.fn(async () => ({
    recipients: [{ key: "customer:c1", type: "CUSTOMER", name: "Ava Chen", email: "ava@example.com", eligibility: null }],
    templates: [],
    draft: null,
    canSend: true,
  })),
  previewComposedEmail: vi.fn(),
  submitComposedEmail: vi.fn(async (input: { action: string }) => ({ ok: true, data: { id: input.action === "draft" ? "draft-1" : "draft-1", status: input.action === "draft" ? "DRAFT" : "QUEUED" } })),
  discardDraft: vi.fn(async () => ({ ok: true, data: undefined })),
}));

import { submitComposedEmail, discardDraft } from "@/app/(app)/email/actions";
import { EmailButton } from "./EmailComposer";

afterEach(cleanup);

describe("email composer: Save draft, then Send", () => {
  it("sends the saved draft instead of creating a second email (no duplicate left in review)", async () => {
    const user = userEvent.setup();
    render(<EmailButton context={{ kind: "customer", id: "c1" }} />);
    await user.click(screen.getByRole("button", { name: /Email/ }));
    await user.type(await screen.findByLabelText(/Subject/), "Your report");
    await user.type(screen.getByLabelText(/Message/), "Hi Ava, it's ready.");

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Draft saved.");
    expect(vi.mocked(submitComposedEmail).mock.calls[0][0]).toMatchObject({ action: "draft", draftId: null });

    // A second save updates the same draft; Send sends that draft.
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    // The buttons relabel while that save is pending; wait for Send to return.
    await user.click(await screen.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(submitComposedEmail).toHaveBeenCalledTimes(3));
    expect(vi.mocked(submitComposedEmail).mock.calls[1][0]).toMatchObject({ action: "draft", draftId: "draft-1" });
    expect(vi.mocked(submitComposedEmail).mock.calls[2][0]).toMatchObject({ action: "send", draftId: "draft-1" });
  });

  it("a saved draft can be discarded from the composer", async () => {
    const user = userEvent.setup();
    render(<EmailButton context={{ kind: "customer", id: "c1" }} />);
    await user.click(screen.getByRole("button", { name: /Email/ }));
    await user.type(await screen.findByLabelText(/Subject/), "x");
    await user.type(screen.getByLabelText(/Message/), "y");
    expect(screen.queryByRole("button", { name: "Discard draft" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await user.click(await screen.findByRole("button", { name: "Discard draft" }));
    expect(discardDraft).toHaveBeenCalledWith("draft-1");
  });
});
