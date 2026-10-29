"use server";

import { Prisma, type Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { BOARD_HREF, LAYOUT_PRESETS, isBoardId, type BoardId } from "@/lib/boards/catalog";
import { defaultLayout, presetLayout, resolveBoardPreferences, validateLayoutSave, withLayout, withoutBoard, type BoardPreferences, type Device, type Tile } from "@/lib/boards/preferences";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

// Only the signed-in user's own layout (the user id comes from the session,
// never the request). Everything saved is re-validated against the catalog
// and the role, so a layout can never name a widget the role can't use.
async function requireUser() {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  assertCan(role, "dashboard:view");
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not signed in.");
  return { role: role!, userId };
}

async function update(userId: string, role: Role, change: (p: BoardPreferences) => BoardPreferences, board: BoardId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { dashboardPreferences: true } });
  const next = change(resolveBoardPreferences(user?.dashboardPreferences, role));
  await prisma.user.update({ where: { id: userId }, data: { dashboardPreferences: next as unknown as Prisma.InputJsonValue } });
  revalidatePath(BOARD_HREF[board]);
  return next;
}

export async function saveBoardLayout(input: unknown): Promise<Result<Tile[]>> {
  const { role, userId } = await requireUser();
  const checked = validateLayoutSave(input, role);
  if (!checked.ok) return checked;
  const { board, device, tiles } = checked.value;
  await update(userId, role, (p) => withLayout(p, board, device, tiles, role), board);
  return { ok: true, data: tiles };
}

// Back to the board's own starting layout, on both devices.
export async function resetBoardLayout(board: unknown): Promise<Result<Tile[]>> {
  const { role, userId } = await requireUser();
  if (!isBoardId(board)) return { ok: false, error: "Unknown board." };
  await update(userId, role, (p) => withoutBoard(p, board), board);
  return { ok: true, data: defaultLayout(board, role).desktop };
}

export async function applyLayoutPreset(board: unknown, device: unknown, presetId: unknown): Promise<Result<Tile[]>> {
  const { role, userId } = await requireUser();
  const preset = LAYOUT_PRESETS.find((p) => p.id === presetId);
  if (!isBoardId(board) || (device !== "desktop" && device !== "phone") || !preset) return { ok: false, error: "Unknown layout." };
  const tiles = presetLayout(preset.tiles, role, board);
  await update(userId, role, (p) => withLayout(p, board, device as Device, tiles, role), board);
  return { ok: true, data: tiles };
}

export async function setHideClearTiles(board: unknown, hide: unknown): Promise<Result<boolean>> {
  const { role, userId } = await requireUser();
  if (!isBoardId(board) || typeof hide !== "boolean") return { ok: false, error: "Invalid setting." };
  await update(userId, role, (p) => ({ ...p, hideClear: hide }), board);
  return { ok: true, data: hide };
}
