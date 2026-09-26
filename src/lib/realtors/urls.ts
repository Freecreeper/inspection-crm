import { DIRECTORY_SORTS, defaultDirFor, type DirectorySort } from "./directoryParams";

// Builds a /realtors URL from the current query string plus a set of
// changes (null removes a key). Changing anything other than the page
// itself sends you back to page 1, and params equal to their defaults are
// dropped so URLs stay short and shareable.
export function directoryHref(
  current: URLSearchParams | string,
  changes: Record<string, string | null>,
  opts: { resetPage?: boolean } = {}
): string {
  const params = new URLSearchParams(typeof current === "string" ? current : current.toString());
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  if ((opts.resetPage ?? true) && !("page" in changes)) params.delete("page");
  if (params.get("page") === "1") params.delete("page");

  const sortRaw = params.get("sort");
  const sort: DirectorySort = sortRaw && (DIRECTORY_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as DirectorySort) : "name";
  if (params.get("dir") === defaultDirFor(sort)) params.delete("dir");
  if (sort === "name") params.delete("sort");

  const qs = params.toString();
  return qs ? `/realtors?${qs}` : "/realtors";
}

// Clicking a column header: first click sorts by it in its natural
// direction, clicking the active column flips it.
export function nextSortChange(currentSort: DirectorySort, currentDir: "asc" | "desc", clicked: DirectorySort) {
  if (currentSort !== clicked) return { sort: clicked, dir: defaultDirFor(clicked) };
  return { sort: clicked, dir: currentDir === "asc" ? "desc" : "asc" };
}
