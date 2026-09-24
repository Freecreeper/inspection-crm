import { describe, it, expect } from "vitest";
import { sortAlphabetically } from "./sort";

describe("sortAlphabetically", () => {
  it("ignores case — a lowercase-first item lands with its letter, not at the end", () => {
    const items = ["Zebra Realty", "apple shop", "Mango Group"];
    expect(sortAlphabetically(items, (s) => s)).toEqual(["apple shop", "Mango Group", "Zebra Realty"]);
  });

  it("does not mutate the input array", () => {
    const items = ["B", "A"];
    sortAlphabetically(items, (s) => s);
    expect(items).toEqual(["B", "A"]);
  });

  it("sorts objects by a derived label", () => {
    const items = [{ name: "beta" }, { name: "Alpha" }];
    expect(sortAlphabetically(items, (i) => i.name)).toEqual([{ name: "Alpha" }, { name: "beta" }]);
  });
});
