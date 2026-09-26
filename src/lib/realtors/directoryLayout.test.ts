import { describe, it, expect } from "vitest";
import { DEFAULT_DIRECTORY_LAYOUT, normalizeDirectoryLayout } from "./directoryLayout";

describe("normalizeDirectoryLayout", () => {
  it("defaults to every column, comfortable rows", () => {
    expect(normalizeDirectoryLayout(null)).toEqual(DEFAULT_DIRECTORY_LAYOUT);
    expect(DEFAULT_DIRECTORY_LAYOUT.columns).toHaveLength(7);
  });

  it("keeps only known columns, in the table's order", () => {
    expect(normalizeDirectoryLayout({ columns: ["nextAction", "name", "phone", 3, "phone"], density: "compact" })).toEqual({
      columns: ["phone", "nextAction"],
      density: "compact",
    });
  });

  it("repairs malformed values instead of failing", () => {
    expect(normalizeDirectoryLayout({ columns: "all", density: "tiny" })).toEqual(DEFAULT_DIRECTORY_LAYOUT);
    expect(normalizeDirectoryLayout({ columns: [] })).toEqual({ columns: [], density: "comfortable" });
  });
});
