import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
const cookieSet = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet }) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), updateSession: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth, updateSession } from "@/lib/auth";
import { saveThemePreference } from "./actions";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "INSPECTOR" } } as never);
  db.user.findUnique.mockResolvedValue({ uiPreferences: { version: 1, navigation: { collapsed: true } } });
});

describe("saveThemePreference", () => {
  it("requires a signed-in user", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(saveThemePreference({ appearance: "dark", palette: "slate" })).rejects.toThrow();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("saves only the signed-in user's own theme, keeping their other settings", async () => {
    await saveThemePreference({ appearance: "dark", palette: "slate", userId: "someone-else" });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { uiPreferences: { version: 1, navigation: { collapsed: true }, theme: { appearance: "dark", palette: "slate" } } },
    });
    expect(cookieSet).toHaveBeenCalledWith("crm-theme", "dark:slate", expect.objectContaining({ path: "/" }));
    expect(updateSession).toHaveBeenCalled();
  });

  it("stores a safe fallback for anything invalid", async () => {
    expect(await saveThemePreference({ appearance: "neon", palette: "custom", custom: { brand: "javascript:", neutral: "cool", sidebar: "light" } })).toEqual({ appearance: "system", palette: "forest" });
  });
});
