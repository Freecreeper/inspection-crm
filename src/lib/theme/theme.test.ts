import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { DEFAULT_THEME, PALETTES, parseThemeCookie, themeCookie } from ".";

describe("theme preference cookie", () => {
  it("reads both halves", () => {
    expect(parseThemeCookie("dark:coastal")).toEqual({ appearance: "dark", palette: "coastal" });
    expect(parseThemeCookie("light:high-contrast")).toEqual({ appearance: "light", palette: "high-contrast" });
  });

  it("falls back per half for anything missing or unknown", () => {
    expect(parseThemeCookie(undefined)).toEqual(DEFAULT_THEME);
    expect(parseThemeCookie("")).toEqual(DEFAULT_THEME);
    expect(parseThemeCookie("dark")).toEqual({ appearance: "dark", palette: "forest" });
    expect(parseThemeCookie("sepia:coastal")).toEqual({ appearance: "system", palette: "coastal" });
    expect(parseThemeCookie("light:<script>")).toEqual({ appearance: "light", palette: "forest" });
  });

  it("round-trips through the cookie it writes", () => {
    const cookie = themeCookie({ appearance: "dark", palette: "earth" });
    expect(cookie).toMatch(/^crm-theme=dark:earth; Path=\/; Max-Age=\d+; SameSite=Lax$/);
    expect(parseThemeCookie(cookie.split(";")[0].split("=")[1])).toEqual({ appearance: "dark", palette: "earth" });
  });
});

describe("generated stylesheet", () => {
  const css = readFileSync(path.join(__dirname, "../../app/theme.css"), "utf8");

  it("has light and dark values for every palette the picker offers", () => {
    for (const { id } of PALETTES) {
      if (id === "forest") continue; // the defaults
      expect(css).toContain(`:root[data-palette="${id}"] {`);
      expect(css).toContain(`:root[data-appearance="dark"][data-palette="${id}"] {`);
      expect(css).toContain(`:root[data-appearance="system"][data-palette="${id}"] {`);
    }
  });

  it("only follows the OS for System", () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s+:root\[data-appearance="system"\]/);
  });
});
