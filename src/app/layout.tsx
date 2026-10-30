import type { Metadata } from "next";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { businessTimeZone } from "@/lib/businessTime";
import { auth } from "@/lib/auth";
import { CUSTOM_THEME_STYLE_ID, THEME_COOKIE, pickThemeOrCompany } from "@/lib/theme";
import { customThemeCss } from "@/lib/theme/custom";
import { getBrand } from "@/lib/brand/service";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The business time zone is published to the browser as a meta tag, so
// client components format dates in the same zone as the server
// (src/lib/businessTime.ts) instead of whatever zone the browser is in.
// The tab title and icon are the company's (Settings → Branding); the icon
// is the uploaded one or the placeholder mark in the brand color.
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const icon = brand.icon?.url ?? `/brand/icon?c=${brand.brandColor.slice(1)}`;
  return {
    title: { default: brand.companyName, template: `%s · ${brand.companyName}` },
    description: `${brand.companyName} — inspections, customers and reports.`,
    icons: { icon, apple: icon },
    other: { "app-timezone": businessTimeZone() },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request so each one gets its own CSP nonce
  // (src/proxy.ts); a page prerendered at build time would carry none and
  // its scripts would be blocked.
  await connection();
  // The viewer's theme, set on <html> before anything paints: the signed-in
  // user's saved one (from the session token, so it follows them to any
  // device) or this browser's cookie, whichever is newer. "System" is
  // resolved by the stylesheet's prefers-color-scheme; a custom theme's
  // colors are inlined.
  // Someone who has never picked colors gets the company's (Settings →
  // Branding), when it has chosen a brand color.
  const session = await auth();
  const brand = await getBrand();
  const theme = pickThemeOrCompany(session?.user?.theme, (await cookies()).get(THEME_COOKIE)?.value, brand.theme);
  return (
    <html
      lang="en"
      data-appearance={theme.appearance}
      data-palette={theme.palette}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Always present (empty unless custom) so the Appearance picker
            updates this one element. Generated from validated colors only. */}
        <style id={CUSTOM_THEME_STYLE_ID} dangerouslySetInnerHTML={{ __html: theme.palette === "custom" && theme.custom ? customThemeCss(theme.custom) : "" }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
