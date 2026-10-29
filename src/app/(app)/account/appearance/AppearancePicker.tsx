"use client";

import { useState } from "react";
import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { APPEARANCES, APPEARANCE_LABELS, PALETTES, applyTheme, type Appearance, type ThemePreference } from "@/lib/theme";

const APPEARANCE_ICONS: Record<Appearance, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };
const APPEARANCE_HINTS: Record<Appearance, string> = {
  system: "Follows your device's light or dark setting.",
  light: "Always light.",
  dark: "Always dark.",
};

// Changes apply to the open page at once and are remembered in this
// browser (a cookie, so the next page load renders in them too).
export function AppearancePicker({ initial }: { initial: ThemePreference }) {
  const [pref, setPref] = useState(initial);

  function choose(next: Partial<ThemePreference>) {
    const merged = { ...pref, ...next };
    setPref(merged);
    applyTheme(merged);
  }

  return (
    <div className="mt-6 space-y-8">
      <fieldset>
        <legend className="text-sm font-semibold text-foreground">Appearance</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {APPEARANCES.map((a) => {
            const Icon = APPEARANCE_ICONS[a];
            const selected = pref.appearance === a;
            return (
              <label
                key={a}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${
                  selected ? "border-ring ring-1 ring-ring" : "border-border hover:border-input"
                }`}
              >
                <input type="radio" name="appearance" value={a} checked={selected} onChange={() => choose({ appearance: a })} className="sr-only" />
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-accent-600" : "text-subtle"}`} aria-hidden="true" />
                <span>
                  <span className="block text-sm font-medium text-foreground">{APPEARANCE_LABELS[a]}</span>
                  <span className="block text-xs text-muted-foreground">{APPEARANCE_HINTS[a]}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-foreground">Color palette</legend>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PALETTES.map((p) => {
            const selected = pref.palette === p.id;
            return (
              <label
                key={p.id}
                className={`relative flex cursor-pointer flex-col gap-2 rounded-lg border bg-surface p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${
                  selected ? "border-ring ring-1 ring-ring" : "border-border hover:border-input"
                }`}
              >
                <input type="radio" name="palette" value={p.id} checked={selected} onChange={() => choose({ palette: p.id })} className="sr-only" />
                {/* Swatches show the palette's own colors, whichever one is active. */}
                <span className="flex h-8 overflow-hidden rounded-md" aria-hidden="true">
                  <span className="flex-[3]" style={{ backgroundColor: p.swatch.accent }} />
                  <span className="flex-[2]" style={{ backgroundColor: p.swatch.tint }} />
                  <span className="flex-1" style={{ backgroundColor: p.swatch.primary }} />
                </span>
                <span className="text-sm font-medium text-foreground">{p.label}</span>
                {selected && <Check className="absolute right-2 top-2 h-4 w-4 rounded-full bg-accent p-0.5 text-accent-foreground" aria-hidden="true" />}
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
