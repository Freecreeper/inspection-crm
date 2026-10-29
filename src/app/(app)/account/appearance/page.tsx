import { cookies } from "next/headers";
import { THEME_COOKIE, parseThemeCookie } from "@/lib/theme";
import { AppearancePicker } from "./AppearancePicker";

export default async function AppearancePage() {
  const initial = parseThemeCookie((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-foreground">Appearance</h1>
      <p className="mt-1 text-sm text-muted-foreground">Light or dark, and the app&apos;s colors. Saved in this browser.</p>
      <AppearancePicker initial={initial} />
    </div>
  );
}
