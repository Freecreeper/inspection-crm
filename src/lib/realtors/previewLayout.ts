// The sections a user can switch on or off in the Realtor preview drawer,
// in display order. Pure (no Prisma) so the drawer and the server share it.
export const PREVIEW_SECTIONS = [
  { key: "nextAction", label: "Next action", defaultOn: true },
  { key: "brokerage", label: "Brokerage", defaultOn: true },
  { key: "transactions", label: "Transactions count", defaultOn: true },
  { key: "referrals", label: "Referrals count", defaultOn: true },
  { key: "revenue", label: "Associated revenue", defaultOn: true },
  { key: "contact", label: "Contact details", defaultOn: true },
  { key: "notes", label: "Notes", defaultOn: false },
  { key: "activity", label: "Recent activity", defaultOn: true },
] as const;

export type PreviewSection = (typeof PREVIEW_SECTIONS)[number]["key"];

export const DEFAULT_PREVIEW_SECTIONS: PreviewSection[] = PREVIEW_SECTIONS.filter((s) => s.defaultOn).map((s) => s.key);

const KNOWN = new Set<string>(PREVIEW_SECTIONS.map((s) => s.key));

// Accepts whatever is stored (or sent) and returns only known keys, in the
// canonical order. Anything unrecognized — or a missing preference — falls
// back to the defaults rather than an empty card.
export function normalizePreviewSections(raw: unknown): PreviewSection[] {
  if (!Array.isArray(raw)) return DEFAULT_PREVIEW_SECTIONS;
  const chosen = new Set(raw.filter((k): k is string => typeof k === "string" && KNOWN.has(k)));
  return PREVIEW_SECTIONS.filter((s) => chosen.has(s.key)).map((s) => s.key);
}
