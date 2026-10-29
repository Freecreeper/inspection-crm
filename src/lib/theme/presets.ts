// The built-in palettes, from Tailwind's own color scales (read from its
// theme.css). Node-only: used by scripts/generate-theme.ts and the theme
// tests, never by the app at runtime (it uses the generated stylesheet).

import { readFileSync } from "node:fs";
import path from "node:path";
import { STOPS, type Oklch, type Scale } from "./color";
import type { StatusScales } from "./css";
import type { ThemeInput } from "./roles";

export const raw: Record<string, Record<string, Oklch>> = {};
for (const m of readFileSync(path.join(process.cwd(), "node_modules/tailwindcss/theme.css"), "utf8").matchAll(/--color-([a-z]+)-(\d+): oklch\(([\d.]+)% ([\d.]+) ([\d.]+|none)\)/g)) {
  (raw[m[1]] ??= {})[m[2]] = { l: Number(m[3]) / 100, c: Number(m[4]), h: m[5] === "none" ? 0 : Number(m[5]) };
}

export const scale = (family: string, { chroma = 1, hue = 0 } = {}): Scale =>
  Object.fromEntries(STOPS.map((s) => [s, { ...raw[family][s], c: raw[family][s].c * chroma, h: raw[family][s].h + hue }])) as Scale;

export const PALETTES: Record<string, ThemeInput & { label: string }> = {
  forest: { label: "Forest", accent: scale("emerald"), neutral: scale("slate"), sidebar: "light" },
  coastal: { label: "Coastal", accent: scale("cyan"), neutral: scale("slate"), sidebar: "light" },
  slate: { label: "Slate", accent: scale("slate", { chroma: 2.4 }), neutral: scale("zinc"), sidebar: "dark" },
  indigo: { label: "Indigo", accent: scale("indigo"), neutral: scale("slate"), sidebar: "light" },
  earth: { label: "Earth", accent: scale("orange", { chroma: 0.55, hue: -8 }), neutral: scale("stone"), sidebar: "tinted" },
  "high-contrast": { label: "High Contrast", accent: scale("blue"), neutral: scale("neutral"), sidebar: "light", highContrast: true },
};

// The same in every palette: meaning never follows the brand color.
export const STATUS: StatusScales = { success: scale("emerald"), warning: scale("amber"), danger: scale("red"), info: scale("blue") };
