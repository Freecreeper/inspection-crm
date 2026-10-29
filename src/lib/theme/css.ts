// Pure: CSS for a palette's tokens, light and dark. Used by the stylesheet
// generator for the built-in palettes and at request time for a custom
// theme, so both go through the same contrast-checked roles.

import { STOPS, formatOklch, type Scale } from "./color";
import { STATUS_KINDS, accentFor, buildTokens, neutralFor, statusTokens, type Mode, type StatusKind, type ThemeInput, type Tokens } from "./roles";

export type StatusScales = Record<StatusKind, Scale>;

export function paletteTokens(input: ThemeInput, mode: Mode, status?: StatusScales): Tokens {
  const tokens = buildTokens(input, mode);
  const n = neutralFor(input, mode);
  const a = accentFor(input, mode);
  return {
    ...tokens,
    ...Object.fromEntries(STOPS.map((s) => [`neutral-${s}`, n[s]])),
    ...Object.fromEntries(STOPS.map((s) => [`accent-${s}`, a[s]])),
    ...(status ? Object.assign({}, ...STATUS_KINDS.map((k) => statusTokens(k, status[k], mode, tokens.surface, input.highContrast))) : {}),
  };
}

export const declarations = (tokens: Tokens, indent = "  ") =>
  Object.entries(tokens)
    .map(([k, v]) => `${indent}--color-${k}: ${formatOklch(v)};`)
    .join("\n");

export const DARK = ':root[data-appearance="dark"]';
export const SYSTEM = ':root[data-appearance="system"]';

// Light block, dark block, and the same dark block for "system" when the
// device prefers dark. `light: false` leaves out the light block (the
// default palette's light values live in @theme).
export function paletteCss(selector: string, input: ThemeInput, status?: StatusScales, { light = true } = {}): string {
  const scoped = (base: string) => (selector === ":root" ? base : `${base}${selector.replace(":root", "")}`);
  const dark = declarations(paletteTokens(input, "dark", status));
  return [
    ...(light ? [`${selector} {\n${declarations(paletteTokens(input, "light", status))}\n}`] : []),
    `${scoped(DARK)} {\n${dark}\n}`,
    `@media (prefers-color-scheme: dark) {\n  ${scoped(SYSTEM)} {\n${declarations(paletteTokens(input, "dark", status), "    ")}\n  }\n}`,
  ].join("\n");
}
