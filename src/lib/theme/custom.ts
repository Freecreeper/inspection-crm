// Pure (client-safe): a custom theme's CSS, built from three choices through
// the same contrast-checked roles as the built-in palettes. Brand colors of
// any lightness are safe: roles pick shades by measured contrast, so a pale
// yellow brand gets dark text on its buttons and a darker link shade.

import { parseHex, scaleFromColor, type Scale } from "./color";
import { paletteCss } from "./css";
import { NEUTRALS } from "./palettes.generated";
import type { ThemeInput } from "./roles";
import type { CustomTheme } from ".";

export function customThemeInput(custom: CustomTheme): ThemeInput {
  return { accent: scaleFromColor(parseHex(custom.brand)!), neutral: NEUTRALS[custom.neutral] as unknown as Scale, sidebar: custom.sidebar };
}

export function customThemeCss(custom: CustomTheme): string {
  return paletteCss(':root[data-palette="custom"]', customThemeInput(custom));
}
