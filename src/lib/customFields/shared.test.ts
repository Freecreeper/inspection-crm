import { describe, it, expect } from "vitest";
import { displayFieldValue, fieldKeyFromLabel, inputFromValue, parseFieldValue, parseOptions } from "./shared";

const field = (dataType: Parameters<typeof parseFieldValue>[0]["dataType"], options: string[] = []) => ({ label: "Field", dataType, options });

describe("parseFieldValue", () => {
  it("treats an empty answer as no value, for every type", () => {
    for (const t of ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT", "MULTISELECT"] as const) {
      expect(parseFieldValue(field(t, ["A"]), t === "MULTISELECT" ? [] : "  ")).toEqual({ ok: true, value: null });
    }
  });

  it("stores text trimmed, and refuses very long text", () => {
    expect(parseFieldValue(field("TEXT"), "  Gate 4  ")).toEqual({ ok: true, value: { value: "Gate 4", valueText: "Gate 4", valueNumber: null, valueDate: null } });
    expect(parseFieldValue(field("TEXT"), "x".repeat(501))).toMatchObject({ ok: false });
  });

  it("accepts numbers with commas or a $, and refuses anything else", () => {
    expect(parseFieldValue(field("NUMBER"), "$1,250.5")).toEqual({ ok: true, value: { value: 1250.5, valueText: null, valueNumber: "1250.5", valueDate: null } });
    for (const raw of ["abc", "1e5", "NaN", "1.23456", "--1"]) expect(parseFieldValue(field("NUMBER"), raw), raw).toMatchObject({ ok: false });
  });

  it("stores a date as its calendar day", () => {
    const r = parseFieldValue(field("DATE"), "2026-11-03");
    expect(r).toEqual({ ok: true, value: { value: "2026-11-03", valueText: null, valueNumber: null, valueDate: new Date("2026-11-03T00:00:00.000Z") } });
    expect(parseFieldValue(field("DATE"), "11/03/2026")).toMatchObject({ ok: false });
  });

  it("yes/no accepts only yes or no", () => {
    expect(parseFieldValue(field("BOOLEAN"), "true")).toMatchObject({ ok: true, value: { value: true, valueText: "Yes" } });
    expect(parseFieldValue(field("BOOLEAN"), false)).toMatchObject({ ok: true, value: { value: false, valueText: "No" } });
    expect(parseFieldValue(field("BOOLEAN"), "maybe")).toMatchObject({ ok: false });
  });

  it("pick-one accepts a listed choice, or the record's current one after it was removed", () => {
    expect(parseFieldValue(field("SELECT", ["Slab", "Basement"]), "Slab")).toMatchObject({ ok: true, value: { value: "Slab" } });
    expect(parseFieldValue(field("SELECT", ["Slab"]), "Pier")).toMatchObject({ ok: false, error: expect.stringContaining("Pier") });
    expect(parseFieldValue(field("SELECT", ["Slab"]), "Pier", "Pier")).toMatchObject({ ok: true, value: { value: "Pier" } });
  });

  it("pick-several keeps listed choices, de-duplicated, in order", () => {
    expect(parseFieldValue(field("MULTISELECT", ["Rush", "Pre-listing"]), ["Rush", "Pre-listing", "Rush"])).toMatchObject({ ok: true, value: { value: ["Rush", "Pre-listing"], valueText: "Rush, Pre-listing" } });
    expect(parseFieldValue(field("MULTISELECT", ["Rush"]), ["Other"])).toMatchObject({ ok: false });
    expect(parseFieldValue(field("MULTISELECT", ["Rush"]), ["Old"], ["Old"])).toMatchObject({ ok: true });
  });
});

describe("display and form input", () => {
  it("reads values the way a person would", () => {
    expect(displayFieldValue("BOOLEAN", true)).toBe("Yes");
    expect(displayFieldValue("BOOLEAN", false)).toBe("No");
    expect(displayFieldValue("DATE", "2026-11-03")).toBe("Nov 3, 2026");
    // Older rows stored a full timestamp; it's still that calendar day.
    expect(displayFieldValue("DATE", "2012-05-01T00:00:00.000Z")).toBe("May 1, 2012");
    expect(displayFieldValue("MULTISELECT", ["Rush", "Pre-listing"])).toBe("Rush, Pre-listing");
    expect(displayFieldValue("NUMBER", 450)).toBe("450");
    expect(displayFieldValue("TEXT", null)).toBe("");
  });

  it("turns a stored value back into the form's input", () => {
    expect(inputFromValue("BOOLEAN", false)).toBe("false");
    expect(inputFromValue("MULTISELECT", null)).toEqual([]);
    expect(inputFromValue("DATE", "2012-05-01T00:00:00.000Z")).toBe("2012-05-01");
  });
});

describe("definitions", () => {
  it("makes a stable key from the label", () => {
    expect(fieldKeyFromLabel("Foundation type")).toBe("foundation_type");
    expect(fieldKeyFromLabel("  Gate code (#)  ")).toBe("gate_code");
    expect(fieldKeyFromLabel("!!!")).toBe("field");
  });

  it("reads choices one per line or comma-separated, without blanks or duplicates", () => {
    expect(parseOptions("Slab\n crawlspace , Basement\n\nslab")).toEqual(["Slab", "crawlspace", "Basement"]);
    expect(parseOptions(["A", " A ", "B"])).toEqual(["A", "B"]);
  });
});
