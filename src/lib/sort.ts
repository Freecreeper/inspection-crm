// Postgres's default collation sorts case-sensitively (every uppercase
// codepoint before every lowercase one), so a plain `orderBy: { name: "asc" }`
// pushes any lowercase-first record to the very end instead of where a
// human would expect it alphabetically. Re-sort in JS wherever the list is
// genuinely meant to read as alphabetical (not e.g. recency-ordered).
export function sortAlphabetically<T>(items: T[], getLabel: (item: T) => string): T[] {
  return [...items].sort((a, b) => getLabel(a).localeCompare(getLabel(b), undefined, { sensitivity: "base" }));
}
