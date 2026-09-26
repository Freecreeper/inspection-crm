import { describe, it, expect } from "vitest";
import { directoryHref, nextSortChange } from "./urls";

describe("directoryHref", () => {
  it("resets to page 1 when anything but the page changes", () => {
    expect(directoryHref("q=sam&page=3", { hasReferrals: "1" })).toBe("/realtors?q=sam&hasReferrals=1");
  });

  it("keeps other params when paging", () => {
    expect(directoryHref("q=sam&sort=referrals", { page: "2" }, { resetPage: false })).toBe("/realtors?q=sam&sort=referrals&page=2");
  });

  it("drops defaults and removed keys", () => {
    expect(directoryHref("q=sam", { q: null })).toBe("/realtors");
    expect(directoryHref("", { sort: "name", dir: "asc" })).toBe("/realtors");
    expect(directoryHref("", { sort: "lastActivity", dir: "desc" })).toBe("/realtors?sort=lastActivity");
    expect(directoryHref("", { page: "1" }, { resetPage: false })).toBe("/realtors");
  });
});

describe("nextSortChange", () => {
  it("starts a new column in its natural direction and flips the active one", () => {
    expect(nextSortChange("name", "asc", "referrals")).toEqual({ sort: "referrals", dir: "desc" });
    expect(nextSortChange("referrals", "desc", "referrals")).toEqual({ sort: "referrals", dir: "asc" });
    expect(nextSortChange("name", "asc", "name")).toEqual({ sort: "name", dir: "desc" });
  });
});
