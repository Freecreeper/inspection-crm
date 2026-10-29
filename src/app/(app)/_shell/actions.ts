"use server";

import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { globalSearch } from "@/lib/search/global";
import type { GlobalSearchResult } from "@/lib/search/kinds";

// Global record search (top bar, every page). Each result kind is filtered
// by its own permission inside globalSearch.
export async function searchEverything(query: string): Promise<GlobalSearchResult[]> {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  assertCan(role, "search:global");
  if (typeof query !== "string") return [];
  return globalSearch(query, role!);
}
