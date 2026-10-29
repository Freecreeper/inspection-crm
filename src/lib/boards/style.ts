// Pure (client-safe). A tile's look: color, fill, shape and density. Colors
// are a short named list (the palette's brand color plus fixed hues) or any
// custom hex; text on a bold fill is picked by measured contrast, so a
// custom color can never make a tile unreadable. Status badges inside a
// tile keep their own fixed colors whatever the tile looks like.

import { WHITE, contrast, formatOklch, parseHex, scaleFromColor, type Oklch } from "@/lib/theme/color";

export const TILE_COLORS = ["auto", "brand", "blue", "teal", "violet", "rose", "orange", "slate"] as const;
export type NamedTileColor = (typeof TILE_COLORS)[number];
export const TILE_COLOR_LABELS: Record<NamedTileColor, string> = {
  auto: "Automatic",
  brand: "Brand",
  blue: "Blue",
  teal: "Teal",
  violet: "Violet",
  rose: "Rose",
  orange: "Orange",
  slate: "Slate",
};
// Fixed hues for the named colors (brand follows the active palette).
const HUES: Record<Exclude<NamedTileColor, "auto" | "brand">, string> = {
  blue: "#2563eb",
  teal: "#0f766e",
  violet: "#7c3aed",
  rose: "#e11d48",
  orange: "#ea580c",
  slate: "#475569",
};

export const FILLS = ["bold", "tint", "outline", "glass"] as const;
export type TileFill = (typeof FILLS)[number];
export const FILL_LABELS: Record<TileFill, string> = { bold: "Bold fill", tint: "Tint", outline: "Outline", glass: "Glass" };

export const SHAPES = ["sharp", "rounded", "squircle", "circle"] as const;
export type TileShape = (typeof SHAPES)[number];
export const SHAPE_LABELS: Record<TileShape, string> = { sharp: "Sharp", rounded: "Rounded", squircle: "Squircle", circle: "Circle" };

export const DENSITIES = ["comfortable", "compact"] as const;
export type TileDensity = (typeof DENSITIES)[number];

export interface TileStyle {
  // A named color, or "#rrggbb".
  color: NamedTileColor | string;
  fill: TileFill;
  shape: TileShape;
  density: TileDensity;
}

export const DEFAULT_STYLE: TileStyle = { color: "auto", fill: "tint", shape: "squircle", density: "comfortable" };

const isNamed = (v: unknown): v is NamedTileColor => typeof v === "string" && (TILE_COLORS as readonly string[]).includes(v);

export function validStyle(raw: unknown): TileStyle;
export function validStyle(raw: unknown, opts: { strict: true }): TileStyle | null;
export function validStyle(raw: unknown, opts?: { strict: true }): TileStyle | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const color = isNamed(r.color) ? r.color : typeof r.color === "string" && parseHex(r.color) ? r.color.toLowerCase() : null;
  const fill = (FILLS as readonly string[]).includes(r.fill as string) ? (r.fill as TileFill) : null;
  const shape = (SHAPES as readonly string[]).includes(r.shape as string) ? (r.shape as TileShape) : null;
  const density = (DENSITIES as readonly string[]).includes(r.density as string) ? (r.density as TileDensity) : null;
  if (opts?.strict && (!color || !fill || !shape || !density)) return null;
  return { color: color ?? DEFAULT_STYLE.color, fill: fill ?? DEFAULT_STYLE.fill, shape: shape ?? DEFAULT_STYLE.shape, density: density ?? DEFAULT_STYLE.density };
}

// The CSS a tile paints with. Brand uses the theme's tokens; other colors
// are computed here with a readable foreground.
export interface TilePaint {
  background: string;
  color: string;
  border: string;
  muted: string;
}

const css = (c: Oklch) => formatOklch(c);

// The most readable text color on `bg`: white, a near-black tinted with
// the same hue, or plain black. One of white or black always clears 4.5:1.
export function textOn(bg: Oklch): Oklch {
  const candidates = [WHITE, { l: 0.18, c: Math.min(bg.c, 0.04), h: bg.h }, { l: 0, c: 0, h: 0 }];
  const tinted = candidates[1];
  if (contrast(tinted, bg) >= 4.5 && contrast(tinted, bg) >= contrast(WHITE, bg)) return tinted;
  return candidates.reduce((best, c) => (contrast(c, bg) > contrast(best, bg) ? c : best));
}

// "Automatic" tiles wear their urgency: overdue red, today amber, soon
// blue (the fixed status colors), calm surface otherwise. Bold fill makes
// that a solid status color.
const STATUS_TOKEN = { overdue: "danger", today: "warning", soon: "info" } as const;

export function tilePaint(style: TileStyle, severity?: "overdue" | "today" | "soon" | "info" | null): TilePaint {
  if (style.color === "auto") {
    const status = severity && severity !== "info" ? STATUS_TOKEN[severity] : null;
    if (status && style.fill === "bold") {
      return { background: `var(--color-${status})`, color: `var(--color-${status}-foreground)`, border: "transparent", muted: `color-mix(in oklab, var(--color-${status}-foreground) 80%, transparent)` };
    }
    if (status && style.fill !== "outline") {
      return { background: `var(--color-${status}-soft)`, color: "var(--color-foreground)", border: `var(--color-${status}-border)`, muted: "var(--color-muted-foreground)" };
    }
    return style.fill === "outline"
      ? { background: "transparent", color: "var(--color-foreground)", border: status ? `var(--color-${status})` : "var(--color-border)", muted: "var(--color-muted-foreground)" }
      : { background: "var(--color-surface)", color: "var(--color-foreground)", border: "var(--color-border)", muted: "var(--color-muted-foreground)" };
  }
  if (style.color === "brand") {
    switch (style.fill) {
      case "bold":
        return { background: "var(--color-accent)", color: "var(--color-accent-foreground)", border: "transparent", muted: "color-mix(in oklab, var(--color-accent-foreground) 78%, transparent)" };
      case "tint":
        return { background: "var(--color-selected)", color: "var(--color-foreground)", border: "transparent", muted: "var(--color-muted-foreground)" };
      case "outline":
        return { background: "var(--color-surface)", color: "var(--color-foreground)", border: "var(--color-accent)", muted: "var(--color-muted-foreground)" };
      case "glass":
        return { background: "color-mix(in oklab, var(--color-accent) 14%, var(--color-surface))", color: "var(--color-foreground)", border: "color-mix(in oklab, var(--color-accent) 30%, transparent)", muted: "var(--color-muted-foreground)" };
    }
  }
  const base = parseHex(isNamed(style.color) ? HUES[style.color as keyof typeof HUES] : style.color)!;
  const scale = scaleFromColor(base);
  switch (style.fill) {
    case "bold": {
      const fg = textOn(base);
      return { background: css(base), color: css(fg), border: "transparent", muted: `color-mix(in oklab, ${css(fg)} 78%, transparent)` };
    }
    case "tint":
      return { background: css(scale[100]), color: css(scale[900]), border: "transparent", muted: css(scale[700]) };
    case "outline":
      return { background: "var(--color-surface)", color: "var(--color-foreground)", border: css(scale[500]), muted: "var(--color-muted-foreground)" };
    case "glass":
      return { background: `color-mix(in oklab, ${css(base)} 16%, var(--color-surface))`, color: "var(--color-foreground)", border: `color-mix(in oklab, ${css(base)} 32%, transparent)`, muted: "var(--color-muted-foreground)" };
  }
}

// Bold fills meet AA for their text (checked in tests for any color).
export function boldContrast(hex: string): number {
  const base = parseHex(hex)!;
  return contrast(textOn(base), base);
}

export const RADIUS: Record<TileShape, string> = { sharp: "4px", rounded: "12px", squircle: "22px", circle: "9999px" };
