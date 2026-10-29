// Pure: turns a palette (a brand scale, a neutral scale, a sidebar style)
// into the semantic tokens components use (bg-primary, text-muted-foreground,
// bg-sidebar-active, bg-danger-soft, …) for light or dark mode. Shades are
// picked by measured contrast, not by fixed stop numbers, so every palette
// (and any custom brand color) gets readable text and focus rings.

import {
  STOPS,
  WHITE,
  contrast,
  firstStopReadableOn,
  firstStopWithWhiteText,
  lightestReadableOn,
  readableOn,
  type Oklch,
  type Scale,
  type Stop,
} from "./color";

export type Mode = "light" | "dark";
export type SidebarStyle = "light" | "tinted" | "dark";

export interface ThemeInput {
  accent: Scale;
  neutral: Scale;
  sidebar: SidebarStyle;
  highContrast?: boolean;
}

export const STATUS_KINDS = ["success", "warning", "danger", "info"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

export type Tokens = Record<string, Oklch>;

const at = (l: number, from: Oklch, maxC = 0.04): Oklch => ({ l, c: Math.min(from.c, maxC), h: from.h });

// Dark neutrals: lightness steps away from the dark surface the way the
// light shades step away from white (designed, not an inversion).
const DARK_L: Record<Stop, number> = { 50: 0.245, 100: 0.28, 200: 0.33, 300: 0.41, 400: 0.55, 500: 0.66, 600: 0.74, 700: 0.82, 800: 0.89, 900: 0.94, 950: 0.97 };
const mirror = (s: Stop): Stop => (s === 50 ? 950 : s === 950 ? 50 : ((1000 - s) as Stop));

export function darkNeutralScale(n: Scale, lift = 0): Scale {
  return Object.fromEntries(STOPS.map((s) => [s, at(Math.min(0.99, DARK_L[s] + (s >= 300 ? lift : lift / 2)), n[mirror(s)])])) as Scale;
}

// High contrast pushes muted text, borders and icons toward the ends.
function pushed(n: Scale, steps: Partial<Record<Stop, number>>): Scale {
  return Object.fromEntries(STOPS.map((s, i) => [s, n[STOPS[Math.min(STOPS.length - 1, i + (steps[s] ?? 0))]]])) as Scale;
}

// The neutral scale pages see for this mode (neutral-* utilities).
export function neutralFor(input: ThemeInput, mode: Mode): Scale {
  if (mode === "dark") return darkNeutralScale(input.neutral, input.highContrast ? 0.08 : 0);
  return input.highContrast ? pushed(input.neutral, { 200: 1, 300: 2, 400: 2, 500: 2, 600: 2, 700: 1, 800: 1 }) : input.neutral;
}

// The brand scale for this mode (accent-* utilities): flipped in dark mode
// so tints become deep and text shades light.
export function accentFor(input: ThemeInput, mode: Mode): Scale {
  return mode === "dark" ? (Object.fromEntries(STOPS.map((s) => [s, input.accent[mirror(s)]])) as Scale) : input.accent;
}

export function buildTokens(input: ThemeInput, mode: Mode): Tokens {
  const n = neutralFor(input, mode);
  const a = input.accent; // roles pick from the unflipped brand scale
  const dark = mode === "dark";
  const hc = Boolean(input.highContrast);
  // Text contrast target: AA, or AAA for High Contrast.
  const min = hc ? 7 : 4.5;

  const background = dark ? (hc ? { l: 0.12, c: 0, h: 0 } : at(0.165, input.neutral[950], 0.03)) : hc ? WHITE : input.neutral[50];
  const surface = dark ? (hc ? { l: 0.17, c: 0, h: 0 } : at(0.215, input.neutral[900], 0.03)) : WHITE;

  // Primary actions are dark neutral; in dark mode, lifted off the surface
  // but still dark enough for white text.
  const primary = dark ? at(hc ? 0.36 : 0.47, input.neutral[700]) : input.neutral[hc ? 950 : 900];
  const primaryHover = dark ? at(hc ? 0.41 : 0.53, input.neutral[700]) : input.neutral[hc ? 900 : 800];

  // Brand fills: the first shade from 600 down that carries white text at AA.
  const accentStop = firstStopWithWhiteText(a, hc ? 700 : 600, min);
  const accentHoverStop = STOPS[Math.min(STOPS.length - 1, STOPS.indexOf(accentStop) + 1)];
  const accentTextStop = dark ? lightestReadableOn(a, surface, 300, min) : firstStopReadableOn(a, surface, hc ? 800 : 700, min);
  const ringStop = dark ? lightestReadableOn(a, surface, 400, 3) : firstStopReadableOn(a, surface, 500, 3);

  const muted = dark ? lightestReadableOn(n, surface, hc ? 800 : 600, min) : firstStopReadableOn(n, background, 500, min);

  const sidebar = sidebarTokens(input, mode, n, surface, min);

  return {
    background,
    surface,
    "surface-secondary": dark ? n[50] : hc ? n[100] : n[50],
    foreground: n[900],
    "muted-foreground": n[muted],
    subtle: n[400],
    border: n[200],
    input: dark ? n[300] : hc ? n[500] : n[300],
    ring: a[ringStop],
    hover: dark ? n[50] : hc ? n[100] : n[50],
    selected: dark ? at(0.3, a[800], 0.07) : a[50],
    primary,
    "primary-hover": primaryHover,
    "primary-foreground": readableOn(primary, n[950]),
    secondary: n[100],
    "secondary-hover": n[200],
    "secondary-foreground": n[800],
    accent: a[accentStop],
    "accent-hover": a[accentHoverStop],
    "accent-foreground": readableOn(a[accentStop], a[950]),
    link: a[accentTextStop],
    scrim: dark ? { l: 0, c: 0, h: 0 } : input.neutral[900],
    ...sidebar,
  };
}

function sidebarTokens(input: ThemeInput, mode: Mode, n: Scale, surface: Oklch, min: number): Tokens {
  const a = input.accent;
  const style = mode === "dark" && input.sidebar === "tinted" ? "light" : input.sidebar;
  if (style === "dark") {
    // A charcoal sidebar (Slate): same in both modes, a step darker than
    // the dark surface in dark mode so it still reads as its own panel.
    const bg = at(mode === "dark" ? 0.18 : 0.25, input.neutral[900], 0.03);
    return {
      sidebar: bg,
      "sidebar-strong": { l: 0.97, c: 0, h: 0 },
      "sidebar-foreground": at(0.86, input.neutral[300]),
      "sidebar-muted": at(0.66, input.neutral[400]),
      "sidebar-hover": at(mode === "dark" ? 0.24 : 0.31, input.neutral[800]),
      "sidebar-active": at(mode === "dark" ? 0.3 : 0.36, a[700], 0.09),
      "sidebar-active-foreground": WHITE,
      "sidebar-border": at(mode === "dark" ? 0.25 : 0.31, input.neutral[800]),
    };
  }
  const tinted = style === "tinted";
  const bg = tinted ? a[50] : surface;
  return {
    sidebar: bg,
    "sidebar-strong": n[900],
    "sidebar-foreground": mode === "dark" ? n[700] : n[600],
    "sidebar-muted": mode === "dark" ? n[500] : n[firstStopReadableOn(n, bg, 400, 3)],
    "sidebar-hover": tinted ? a[100] : n[100],
    "sidebar-active": mode === "dark" ? at(0.3, a[800], 0.07) : tinted ? a[100] : a[50],
    "sidebar-active-foreground": mode === "dark" ? a[lightestReadableOn(a, at(0.3, a[800], 0.07), 300, min)] : a[firstStopReadableOn(a, tinted ? a[100] : a[50], 700, min)],
    "sidebar-border": tinted ? a[100] : n[200],
  };
}

// Status colors keep their meaning in every palette (green success, amber
// warning, red danger, blue info); only the mode changes them.
export function statusTokens(kind: StatusKind, f: Scale, mode: Mode, surface: Oklch, highContrast = false): Tokens {
  const min = highContrast ? 7 : 4.5;
  const solid = firstStopWithWhiteText(f, highContrast ? 700 : 600, min);
  const hover = STOPS[Math.min(STOPS.length - 1, STOPS.indexOf(solid) + 1)];
  const soft = mode === "dark" ? at(0.28, f[900], 0.07) : f[50];
  const strong = mode === "dark" ? f[lightestReadableOn(f, soft, 300, min)] : f[firstStopReadableOn(f, soft, highContrast ? 800 : 700, min)];
  return {
    [kind]: f[solid],
    [`${kind}-hover`]: f[hover],
    [`${kind}-foreground`]: readableOn(f[solid], f[950]),
    [`${kind}-soft`]: soft,
    [`${kind}-strong`]: contrast(strong, surface) >= min ? strong : mode === "dark" ? f[100] : f[900],
    [`${kind}-border`]: mode === "dark" ? f[800] : f[200],
  };
}
