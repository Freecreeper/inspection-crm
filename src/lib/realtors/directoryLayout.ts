// A user's own Realtor directory layout. Pure (no Prisma) so the page, the
// toolbar, and the server action share one allow-list.
export const DIRECTORY_COLUMNS = [
  { key: "brokerage", label: "Brokerage" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "transactions", label: "Transactions" },
  { key: "referrals", label: "Referrals" },
  { key: "lastActivity", label: "Last activity" },
  { key: "nextAction", label: "Next action" },
] as const;

export type DirectoryColumn = (typeof DIRECTORY_COLUMNS)[number]["key"];
export type Density = "comfortable" | "compact";

export interface DirectoryLayout {
  // The Realtor name column is always shown and isn't listed here.
  columns: DirectoryColumn[];
  density: Density;
}

export const DEFAULT_DIRECTORY_LAYOUT: DirectoryLayout = {
  columns: DIRECTORY_COLUMNS.map((c) => c.key),
  density: "comfortable",
};

const KNOWN = new Set<string>(DIRECTORY_COLUMNS.map((c) => c.key));

// Whatever is stored (or sent) comes back as a valid layout: known columns
// only, in the canonical order; anything malformed falls back to defaults.
export function normalizeDirectoryLayout(raw: unknown): DirectoryLayout {
  if (!raw || typeof raw !== "object") return DEFAULT_DIRECTORY_LAYOUT;
  const { columns, density } = raw as { columns?: unknown; density?: unknown };
  const chosen = Array.isArray(columns) ? new Set(columns.filter((c): c is string => typeof c === "string" && KNOWN.has(c))) : null;
  return {
    columns: chosen ? DIRECTORY_COLUMNS.filter((c) => chosen.has(c.key)).map((c) => c.key) : DEFAULT_DIRECTORY_LAYOUT.columns,
    density: density === "compact" ? "compact" : "comfortable",
  };
}
