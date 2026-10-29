import { describe, it, expect } from "vitest";
import { contrast, parseHex, scaleFromColor, type Oklch } from "./color";
import { paletteTokens } from "./css";
import { PALETTES, STATUS } from "./presets";
import { STATUS_KINDS } from "./roles";

// Text pairs must meet WCAG AA (4.5:1); focus rings and other UI
// boundaries 3:1. High Contrast holds text to AAA (7:1).
const TEXT_PAIRS: [string, string][] = [
  ["foreground", "surface"],
  ["foreground", "background"],
  ["muted-foreground", "surface"],
  ["muted-foreground", "background"],
  ["primary-foreground", "primary"],
  ["primary-foreground", "primary-hover"],
  ["accent-foreground", "accent"],
  ["accent-foreground", "accent-hover"],
  ["link", "surface"],
  ["secondary-foreground", "secondary"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-strong", "sidebar"],
  ["sidebar-foreground", "sidebar-hover"],
  ["sidebar-active-foreground", "sidebar-active"],
  ...STATUS_KINDS.flatMap((k): [string, string][] => [
    [`${k}-foreground`, k],
    [`${k}-strong`, `${k}-soft`],
    [`${k}-strong`, "surface"],
  ]),
];
const UI_PAIRS: [string, string][] = [
  ["ring", "surface"],
  ["sidebar-muted", "sidebar"],
];

const failures = (tokens: Record<string, Oklch>, pairs: [string, string][], min: number) =>
  pairs.filter(([fg, bg]) => contrast(tokens[fg], tokens[bg]) < min).map(([fg, bg]) => `${fg} on ${bg}: ${contrast(tokens[fg], tokens[bg]).toFixed(2)}`);

describe.each(Object.keys(PALETTES))("palette %s", (id) => {
  const p = PALETTES[id];
  it.each(["light", "dark"] as const)("meets contrast targets in %s mode", (mode) => {
    const tokens = paletteTokens(p, mode, STATUS);
    expect(failures(tokens, TEXT_PAIRS, p.highContrast ? 7 : 4.5)).toEqual([]);
    expect(failures(tokens, UI_PAIRS, 3)).toEqual([]);
    if (p.highContrast) expect(failures(tokens, [["input", "surface"]], 3)).toEqual([]);
  });

  it("keeps status colors off the brand color", () => {
    const tokens = paletteTokens(p, "light", STATUS);
    // Success stays green, warning amber, danger red, info blue (hue ranges).
    const hue = (k: string) => tokens[k].h;
    expect(hue("success")).toBeGreaterThan(140);
    expect(hue("success")).toBeLessThan(180);
    expect(hue("warning")).toBeGreaterThan(40);
    expect(hue("warning")).toBeLessThan(90);
    expect(hue("danger") < 40 || hue("danger") > 340).toBe(true);
    expect(hue("info")).toBeGreaterThan(230);
    expect(hue("info")).toBeLessThan(280);
  });
});

describe("dark mode", () => {
  it("has a real hierarchy, not pure black", () => {
    for (const p of Object.values(PALETTES)) {
      const t = paletteTokens(p, "dark", STATUS);
      expect(t.background.l).toBeGreaterThan(0.1);
      expect(t.surface.l).toBeGreaterThan(t.background.l);
    }
  });
});

describe("a brand color of any lightness still yields readable roles", () => {
  it.each(["#ffeb3b", "#00ff00", "#0a0a40", "#e91e63", "#9e9e9e", "#00bcd4"])("%s", (hex) => {
    const input = { accent: scaleFromColor(parseHex(hex)!), neutral: PALETTES.forest.neutral, sidebar: "tinted" as const };
    for (const mode of ["light", "dark"] as const) {
      const tokens = paletteTokens(input, mode);
      // Custom themes reuse the fixed status colors, so only brand pairs apply.
      const brandPairs = TEXT_PAIRS.filter((pair) => !pair.some((token) => STATUS_KINDS.some((k) => token.startsWith(k))));
      expect(failures(tokens, brandPairs, 4.5)).toEqual([]);
      expect(failures(tokens, UI_PAIRS, 3)).toEqual([]);
    }
  });
});
