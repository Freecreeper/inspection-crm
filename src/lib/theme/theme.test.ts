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

describe("custom themes and saved preferences", () => {
  const custom = { brand: "#1F7A5A", neutral: "warm", sidebar: "dark" } as const;

  it("round-trips a custom theme through the compact form", async () => {
    const { encodeTheme, parseThemeCookie } = await import(".");
    const encoded = encodeTheme({ appearance: "light", palette: "custom", custom: { ...custom, brand: "#1f7a5a" } });
    expect(encoded).toBe("light:custom:1f7a5a:warm:dark");
    expect(parseThemeCookie(encoded)).toEqual({ appearance: "light", palette: "custom", custom: { brand: "#1f7a5a", neutral: "warm", sidebar: "dark" } });
  });

  it("falls back safely from invalid custom colors", async () => {
    const { parseThemeCookie, validTheme } = await import(".");
    expect(parseThemeCookie("dark:custom:zzzzzz:warm:dark")).toEqual({ appearance: "dark", palette: "forest" });
    expect(parseThemeCookie("dark:custom")).toEqual({ appearance: "dark", palette: "forest" });
    expect(validTheme({ appearance: "dark", palette: "custom", custom: { ...custom, sidebar: "neon" } })).toEqual({ appearance: "dark", palette: "forest" });
    expect(validTheme({ palette: "custom", custom: { ...custom, brand: "red" } }).palette).toBe("forest");
    expect(validTheme("nonsense")).toEqual(DEFAULT_THEME);
  });

  it("stores the theme in a versioned document and keeps other settings", async () => {
    const { themeFromUiPreferences, uiPreferencesWithTheme } = await import(".");
    const doc = uiPreferencesWithTheme({ version: 1, navigation: { collapsed: true } }, { appearance: "dark", palette: "slate" });
    expect(doc).toEqual({ version: 1, navigation: { collapsed: true }, theme: { appearance: "dark", palette: "slate" } });
    expect(themeFromUiPreferences(doc)).toEqual({ appearance: "dark", palette: "slate" });
    expect(themeFromUiPreferences({ version: 2, theme: { appearance: "dark" } })).toBeNull();
    expect(themeFromUiPreferences("x")).toBeNull();
    expect(uiPreferencesWithTheme("garbage", DEFAULT_THEME)).toEqual({ version: 1, theme: DEFAULT_THEME });
  });

  it("builds readable CSS for a custom theme", async () => {
    const { customThemeCss } = await import("./custom");
    const css = customThemeCss({ brand: "#ffeb3b", neutral: "cool", sidebar: "tinted" });
    expect(css).toContain(':root[data-palette="custom"] {');
    expect(css).toContain(':root[data-appearance="dark"][data-palette="custom"] {');
    expect(css).toMatch(/--color-accent-foreground: oklch\(/);
  });
});
