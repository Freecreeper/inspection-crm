import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { THEME_COOKIE, parseThemeCookie } from "@/lib/theme";
import { AppearancePicker } from "./AppearancePicker";

// Each person's own appearance. Saved to their account, so it follows them
// to every device; nothing here affects anyone else.
export default async function AppearancePage() {
  const session = await auth();
  const initial = parseThemeCookie(session?.user?.theme ?? (await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Settings</p>
      <h1 className="text-2xl font-semibold text-foreground">Appearance</h1>
      <p className="mt-1 text-sm text-muted-foreground">Light or dark, and the app&apos;s colors. Saved to your account, so it follows you to any device.</p>
      <AppearancePicker initial={initial} />
    </div>
  );
}
