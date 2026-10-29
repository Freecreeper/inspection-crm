// Pure color math for the theme system: OKLCH (the space the palettes are
// designed in) to sRGB, WCAG contrast, gamut clamping, and generating a
// full 50–950 scale from one color. Shared by the stylesheet generator
// (scripts/generate-theme.ts), its contrast tests, and custom themes.

export interface Oklch {
  l: number; // 0–1
  c: number;
  h: number; // degrees
}

export const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type Stop = (typeof STOPS)[number];
export type Scale = Record<Stop, Oklch>;

export const formatOklch = ({ l, c, h }: Oklch) => `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${h.toFixed(2)})`;

// OKLCH → linear sRGB (Björn Ottosson's OKLab matrices).
function toLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

export function inGamut(color: Oklch): boolean {
  return toLinearRgb(color).every((v) => v >= -0.0005 && v <= 1.0005);
}

// Lowers chroma until the color is displayable in sRGB, keeping its
// lightness and hue (so contrast stays what the scale intended).
export function clampToGamut(color: Oklch): Oklch {
  if (inGamut(color)) return color;
  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut({ ...color, c: mid })) lo = mid;
    else hi = mid;
  }
  return { ...color, c: lo };
}

// WCAG relative luminance from the (clamped) linear sRGB values.
export function luminance(color: Oklch): number {
  const [r, g, b] = toLinearRgb(clampToGamut(color)).map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: Oklch, b: Oklch): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const WHITE: Oklch = { l: 1, c: 0, h: 0 };

// White or the scale's darkest shade, whichever reads better on `bg`.
export function readableOn(bg: Oklch, dark: Oklch): Oklch {
  return contrast(WHITE, bg) >= contrast(dark, bg) ? WHITE : dark;
}

// The first stop at or after `from` (moving darker) whose white text meets
// `min` contrast; falls back to the darkest stop.
export function firstStopWithWhiteText(scale: Scale, from: Stop, min = 4.5): Stop {
  const start = STOPS.indexOf(from);
  for (const s of STOPS.slice(start)) if (contrast(WHITE, scale[s]) >= min) return s;
  return 950;
}

// The first stop (moving darker from `from`) that meets `min` contrast on `bg`.
export function firstStopReadableOn(scale: Scale, bg: Oklch, from: Stop, min = 4.5): Stop {
  for (const s of STOPS.slice(STOPS.indexOf(from))) if (contrast(scale[s], bg) >= min) return s;
  return 950;
}

// The lightest stop (moving lighter from `from`) that meets `min` on a dark `bg`.
export function lightestReadableOn(scale: Scale, bg: Oklch, from: Stop, min = 4.5): Stop {
  for (const s of [...STOPS.slice(0, STOPS.indexOf(from) + 1)].reverse()) if (contrast(scale[s], bg) >= min) return s;
  return 50;
}

// Tailwind's lightness ramp and chroma profile (relative to stop 500),
// averaged from its chromatic scales. A generated scale follows it, so a
// custom color behaves like the built-in palettes.
const L_RAMP: Record<Stop, number> = { 50: 0.975, 100: 0.945, 200: 0.89, 300: 0.81, 400: 0.71, 500: 0.62, 600: 0.54, 700: 0.47, 800: 0.4, 900: 0.35, 950: 0.26 };
const C_PROFILE: Record<Stop, number> = { 50: 0.1, 100: 0.22, 200: 0.42, 300: 0.68, 400: 0.9, 500: 1, 600: 0.96, 700: 0.86, 800: 0.72, 900: 0.58, 950: 0.42 };

export function scaleFromColor(base: Oklch): Scale {
  const chroma = Math.max(0.02, base.c);
  return Object.fromEntries(STOPS.map((s) => [s, clampToGamut({ l: L_RAMP[s], c: chroma * C_PROFILE[s], h: base.h })])) as Scale;
}

// "#1f7a5a" → OKLCH. Only 6-digit hex; anything else is null.
export function parseHex(hex: string): Oklch | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = lin;
  const l = Math.cbrt(0.4122214708 * r + 0.5363015264 * g + 0.0514770718 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}
