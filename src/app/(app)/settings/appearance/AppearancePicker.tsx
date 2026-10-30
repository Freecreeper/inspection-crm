"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Monitor, Moon, RotateCcw, Sun, type LucideIcon } from "lucide-react";
import {
  APPEARANCES,
  APPEARANCE_LABELS,
  DEFAULT_CUSTOM,
  DEFAULT_THEME,
  NEUTRAL_TONES,
  NEUTRAL_TONE_LABELS,
  PALETTES,
  SIDEBAR_STYLES,
  SIDEBAR_STYLE_LABELS,
  applyTheme,
  validCustom,
  type Appearance,
  type CustomTheme,
  type ThemePreference,
} from "@/lib/theme";
import { saveThemePreference } from "./actions";

const APPEARANCE_ICONS: Record<Appearance, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };
const APPEARANCE_HINTS: Record<Appearance, string> = {
  system: "Follows your device's light or dark setting.",
  light: "Always light.",
  dark: "Always dark.",
};
const SAVE_DELAY_MS = 400;

const card = (selected: boolean) =>
  `relative flex cursor-pointer rounded-lg border bg-surface p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${
    selected ? "border-ring ring-1 ring-ring" : "border-border hover:border-input"
  }`;

// Every change shows at once and is saved to the account a moment later
// (one save per pause, so dragging the color picker doesn't flood the
// server). The server validates again; what it saved is what's kept.
// `company` is the company's colors (Settings → Branding), when set: the
// default for anyone who hasn't picked, and one click away for those who have.
export function AppearancePicker({ initial, company = null }: { initial: ThemePreference; company?: CustomTheme | null }) {
  const [pref, setPref] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const custom = pref.custom ?? DEFAULT_CUSTOM;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function choose(choice: ThemePreference) {
    const next = applyTheme(choice);
    setPref(next);
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await saveThemePreference(next);
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, SAVE_DELAY_MS);
  }

  const setCustom = (changes: Partial<CustomTheme>) => {
    const merged = validCustom({ ...custom, ...changes });
    if (merged) choose({ ...pref, palette: "custom", custom: merged });
  };

  return (
    <div className="mt-6 space-y-8">
      <fieldset>
        <legend className="text-sm font-semibold text-foreground">Mode</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {APPEARANCES.map((a) => {
            const Icon = APPEARANCE_ICONS[a];
            const selected = pref.appearance === a;
            return (
              <label key={a} className={`${card(selected)} items-start gap-3`}>
                <input type="radio" name="appearance" value={a} checked={selected} onChange={() => choose({ ...pref, appearance: a })} className="sr-only" />
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-link" : "text-subtle"}`} aria-hidden="true" />
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
        <legend className="text-sm font-semibold text-foreground">Color theme</legend>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PALETTES.map((p) => {
            const selected = pref.palette === p.id;
            return (
              <label key={p.id} className={`${card(selected)} flex-col gap-2`}>
                <input type="radio" name="palette" value={p.id} checked={selected} onChange={() => choose({ ...pref, palette: p.id })} className="sr-only" />
                <ThemePreview sidebar={p.swatch.sidebar} accent={p.swatch.accent} tint={p.swatch.tint} primary={p.swatch.primary} />
                <span className="text-sm font-medium text-foreground">{p.label}</span>
                {selected && <SelectedMark />}
              </label>
            );
          })}
          <label className={`${card(pref.palette === "custom")} flex-col gap-2`}>
            <input type="radio" name="palette" value="custom" checked={pref.palette === "custom"} onChange={() => setCustom({})} className="sr-only" />
            <ThemePreview sidebar={custom.sidebar === "dark" ? "#27272a" : "#ffffff"} accent={custom.brand} tint={`color-mix(in oklab, ${custom.brand} 12%, white)`} primary="#0f172a" />
            <span className="text-sm font-medium text-foreground">Custom</span>
            {pref.palette === "custom" && <SelectedMark />}
          </label>
        </div>
      </fieldset>

      {pref.palette === "custom" && (
        <fieldset className="rounded-lg border border-border bg-surface p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">Customize theme</legend>
          <p className="text-xs text-muted-foreground">Pick a brand color; text, buttons, links and focus rings are worked out from it so they stay readable in light and dark.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block text-sm font-medium text-neutral-700">
              Brand color
              <span className="mt-1 flex items-center gap-2">
                <input type="color" value={custom.brand} onChange={(e) => setCustom({ brand: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-input bg-surface p-0.5" />
                <input
                  key={custom.brand}
                  defaultValue={custom.brand}
                  aria-label="Brand color hex"
                  maxLength={7}
                  onBlur={(e) => setCustom({ brand: e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}` })}
                  className="h-9 w-24 rounded-md border border-input bg-surface px-2 font-mono text-sm"
                />
              </span>
            </label>
            <Choice label="Neutral tone" value={custom.neutral} options={NEUTRAL_TONES.map((t) => [t, NEUTRAL_TONE_LABELS[t]])} onChange={(neutral) => setCustom({ neutral })} />
            <Choice label="Sidebar" value={custom.sidebar} options={SIDEBAR_STYLES.map((s) => [s, SIDEBAR_STYLE_LABELS[s]])} onChange={(sidebar) => setCustom({ sidebar })} />
          </div>
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => choose(company ? { ...DEFAULT_THEME, palette: "custom", custom: company } : { ...DEFAULT_THEME, ...(pref.custom ? { custom: pref.custom } : {}) })}
          disabled={
            company
              ? pref.appearance === DEFAULT_THEME.appearance && pref.palette === "custom" && pref.custom?.brand === company.brand && pref.custom?.neutral === company.neutral && pref.custom?.sidebar === company.sidebar
              : pref.appearance === DEFAULT_THEME.appearance && pref.palette === DEFAULT_THEME.palette
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-surface px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-hover disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> {company ? "Use company colors" : "Reset to default"}
        </button>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved to your account." : status === "error" ? <span className="text-danger-strong">Couldn&apos;t save. Your choice still applies here.</span> : null}
        </p>
      </div>
    </div>
  );
}

function SelectedMark() {
  return <Check className="absolute right-2 top-2 h-4 w-4 rounded-full bg-accent p-0.5 text-accent-foreground" aria-hidden="true" />;
}

// A tiny picture of the app in the theme: sidebar, an accent bar, a tint
// and a primary button.
function ThemePreview({ sidebar, accent, tint, primary }: { sidebar: string; accent: string; tint: string; primary: string }) {
  return (
    <span className="flex h-12 overflow-hidden rounded-md border border-border" aria-hidden="true">
      <span className="flex w-1/3 flex-col gap-1 p-1.5" style={{ backgroundColor: sidebar }}>
        <span className="h-1.5 rounded-sm" style={{ backgroundColor: tint }} />
        <span className="h-1.5 w-2/3 rounded-sm opacity-40" style={{ backgroundColor: accent }} />
      </span>
      <span className="flex flex-1 flex-col justify-between bg-white p-1.5">
        <span className="h-1.5 w-3/4 rounded-sm" style={{ backgroundColor: accent }} />
        <span className="h-3 w-1/2 self-end rounded-sm" style={{ backgroundColor: primary }} />
      </span>
    </span>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <div>
      <p className="text-sm font-medium text-neutral-700" id={id}>
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={id} className="mt-1 flex rounded-lg bg-neutral-100 p-0.5">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`flex-1 rounded-md px-2 py-1.5 text-sm font-medium ${value === v ? "bg-surface text-foreground shadow-sm" : "text-neutral-600 hover:text-foreground"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
