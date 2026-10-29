// Generates src/app/theme.css, the app's whole color system: run
// `node scripts/generate-theme.mjs` after changing a palette below, and
// commit the output. Pages never name raw colors for chrome; they use these
// tokens (Tailwind utilities like bg-accent-50, text-neutral-600), so one
// file decides how every screen looks in every palette and appearance.
//
// Tokens
//   neutral-50…950        grays for text, borders and quiet fills
//   accent-50…950         the palette's brand color (active states, links)
//   <color>-solid-50…950  filled buttons and dots (bg-accent-solid-600 with
//                         text-white); kept saturated in dark mode instead
//                         of inverting, so white text stays readable
//   surface               cards, panels, the sidebar (was bg-white)
//   canvas                the page background behind them
//   scrim                 dimming behind dialogs
//   red/amber/blue/…      status colors: Tailwind's, inverted in dark mode
//
// Dark mode isn't a second set of class names: the same tokens get dark
// values (tints become deep, text shades become light), under
// [data-appearance="dark"], or "system" when the OS prefers dark.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const CHROMATIC = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];

// Tailwind's own values, so status colors and palettes match its scales.
const raw = {};
for (const m of readFileSync(path.join(root, "node_modules/tailwindcss/theme.css"), "utf8").matchAll(/--color-([a-z]+)-(\d+): oklch\(([\d.]+)% ([\d.]+) ([\d.]+|none)\)/g)) {
  (raw[m[1]] ??= {})[m[2]] = { l: Number(m[3]) / 100, c: Number(m[4]), h: m[5] === "none" ? 0 : Number(m[5]) };
}

const fmt = ({ l, c, h }) => `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${h.toFixed(2)})`;
const scale = (family, { chroma = 1, hue = 0 } = {}) =>
  Object.fromEntries(STOPS.map((s) => [s, { ...raw[family][s], c: raw[family][s].c * chroma, h: raw[family][s].h + hue }]));
const mirror = (s) => (s === 50 ? 950 : s === 950 ? 50 : 1000 - s);
const invert = (sc) => Object.fromEntries(STOPS.map((s) => [s, sc[mirror(s)]]));

// Dark neutrals: each stop steps away from the dark surface by lightness,
// the way the light stops step away from white. Chroma and hue follow the
// family so warm palettes stay warm.
const DARK_NEUTRAL_L = { 50: 0.245, 100: 0.28, 200: 0.33, 300: 0.41, 400: 0.55, 500: 0.66, 600: 0.74, 700: 0.82, 800: 0.89, 900: 0.94, 950: 0.97 };
// Solid neutral fills (primary buttons, bg-neutral-solid-900 + white text)
// in dark mode: lifted off the dark surface, still dark enough for white.
const DARK_NEUTRAL_SOLID_L = { 50: 0.3, 100: 0.32, 200: 0.34, 300: 0.36, 400: 0.38, 500: 0.42, 600: 0.5, 700: 0.46, 800: 0.53, 900: 0.47, 950: 0.42 };
const darkNeutral = (sc, table = DARK_NEUTRAL_L) => Object.fromEntries(STOPS.map((s) => [s, { l: table[s], c: Math.min(sc[mirror(s)].c, 0.04), h: sc[mirror(s)].h }]));

// High contrast: muted text, borders and icons pushed toward the ends.
const push = (sc, steps) => Object.fromEntries(STOPS.map((s, i) => [s, sc[STOPS[Math.min(STOPS.length - 1, Math.max(0, i + (steps[s] ?? 0)))]]]));
const HC_LIGHT = { 200: 1, 300: 2, 400: 2, 500: 2, 600: 2, 700: 1, 800: 1 };

export const PALETTES = {
  forest: { label: "Forest", accent: scale("emerald"), neutral: scale("slate") },
  coastal: { label: "Coastal", accent: scale("cyan"), neutral: scale("slate") },
  slate: { label: "Slate", accent: scale("slate", { chroma: 2.4 }), neutral: scale("zinc") },
  indigo: { label: "Indigo", accent: scale("indigo"), neutral: scale("slate") },
  earth: { label: "Earth", accent: scale("orange", { chroma: 0.55, hue: -8 }), neutral: scale("stone") },
  "high-contrast": { label: "High Contrast", accent: push(scale("blue"), { 500: 2, 600: 2, 700: 2, 800: 1 }), neutral: push(scale("neutral"), HC_LIGHT), highContrast: true },
};

function lightVars(p) {
  return {
    ...Object.fromEntries(STOPS.map((s) => [`accent-${s}`, p.accent[s]])),
    ...Object.fromEntries(STOPS.map((s) => [`accent-solid-${s}`, p.accent[s]])),
    ...Object.fromEntries(STOPS.map((s) => [`neutral-${s}`, p.neutral[s]])),
    ...Object.fromEntries(STOPS.map((s) => [`neutral-solid-${s}`, p.neutral[s]])),
    surface: { l: 1, c: 0, h: 0 },
    canvas: p.highContrast ? { l: 1, c: 0, h: 0 } : p.neutral[50],
    scrim: p.neutral[900],
  };
}

function darkVars(p) {
  const neutral = p.highContrast
    ? Object.fromEntries(STOPS.map((s) => [s, { ...darkNeutral(p.neutral)[s], l: Math.min(1, darkNeutral(p.neutral)[s].l + (s >= 300 ? 0.1 : 0.05)) }]))
    : darkNeutral(p.neutral);
  return {
    ...Object.fromEntries(STOPS.map((s) => [`accent-${s}`, invert(p.accent)[s]])),
    ...Object.fromEntries(STOPS.map((s) => [`neutral-${s}`, neutral[s]])),
    ...Object.fromEntries(STOPS.map((s) => [`neutral-solid-${s}`, darkNeutral(p.neutral, DARK_NEUTRAL_SOLID_L)[s]])),
    surface: p.highContrast ? { l: 0.13, c: 0, h: 0 } : { l: 0.215, c: Math.min(p.neutral[900].c, 0.03), h: p.neutral[900].h },
    canvas: p.highContrast ? { l: 0, c: 0, h: 0 } : { l: 0.165, c: Math.min(p.neutral[950].c, 0.03), h: p.neutral[950].h },
    scrim: { l: 0, c: 0, h: 0 },
  };
}

// Status colors in dark mode: the scale flipped, so a bg-red-50 badge turns
// deep red and its text-red-700 turns light. Their -solid fills keep the
// light values in both modes.
const darkChromatic = Object.fromEntries(CHROMATIC.flatMap((f) => STOPS.map((s) => [`${f}-${s}`, raw[f][mirror(s)]])));

const block = (selector, vars, extra = "") =>
  `${selector} {\n${extra}${Object.entries(vars).map(([k, v]) => `  --color-${k}: ${fmt(v)};`).join("\n")}\n}\n`;

const DARK = ':root[data-appearance="dark"]';
const SYSTEM = ':root[data-appearance="system"]';
const darkBlocks = (base) =>
  block(base, { ...darkChromatic, ...darkVars(PALETTES.forest) }, "  color-scheme: dark;\n") +
  Object.entries(PALETTES)
    .filter(([id]) => id !== "forest")
    .map(([id, p]) => block(`${base}[data-palette="${id}"]`, darkVars(p)))
    .join("");

const css = [
  "/* GENERATED by scripts/generate-theme.mjs; edit that, then run it. */\n",
  // Defaults (Forest, light) live in @theme so Tailwind generates the
  // utilities; the blocks below only swap values.
  block("@theme", {
    ...lightVars(PALETTES.forest),
    ...Object.fromEntries(CHROMATIC.flatMap((f) => STOPS.map((s) => [`${f}-solid-${s}`, raw[f][s]]))),
  }),
  ...Object.entries(PALETTES)
    .filter(([id]) => id !== "forest")
    .map(([id, p]) => block(`:root[data-palette="${id}"]`, lightVars(p))),
  darkBlocks(DARK),
  "@media (prefers-color-scheme: dark) {\n" + darkBlocks(SYSTEM).replace(/^/gm, "  ").trimEnd() + "\n}\n",
].join("\n");

writeFileSync(path.join(root, "src/app/theme.css"), css);

// The palette list for the Appearance picker, with swatch colors, so the
// picker and the stylesheet can't drift apart.
const swatches = Object.entries(PALETTES).map(([id, p]) => ({
  id,
  label: p.label,
  accent: fmt(p.accent[600]),
  tint: fmt(p.accent[100]),
  neutral: fmt(p.neutral[700]),
}));
writeFileSync(
  path.join(root, "src/lib/theme/palettes.generated.ts"),
  `// GENERATED by scripts/generate-theme.mjs; edit that, then run it.\n\nexport const PALETTES = ${JSON.stringify(swatches, null, 2)} as const;\n`
);
console.log(`Wrote src/app/theme.css (${css.length} bytes) and src/lib/theme/palettes.generated.ts (${swatches.length} palettes)`);
