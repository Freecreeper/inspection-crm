// Pure. Which library narratives fit a report component: those with no
// hints, or whose component hint or section hint matches (either way round,
// case-insensitive: "Water heater" fits "Water Heater (Gas)").

export interface NarrativeHints {
  componentHint: string | null;
  sectionHint: string | null;
}

const fits = (hint: string | null, name: string) => {
  if (!hint) return false;
  const a = hint.trim().toLowerCase();
  const b = name.trim().toLowerCase();
  return a.length > 0 && (a.includes(b) || b.includes(a));
};

export function narrativeFits(n: NarrativeHints, componentName: string, sectionName: string): boolean {
  if (!n.componentHint && !n.sectionHint) return true;
  if (n.componentHint) return fits(n.componentHint, componentName);
  return fits(n.sectionHint, sectionName);
}
