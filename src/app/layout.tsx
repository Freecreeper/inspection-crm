import type { Metadata } from "next";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { businessTimeZone } from "@/lib/businessTime";
import { THEME_COOKIE, parseThemeCookie } from "@/lib/theme";
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
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Inspection CRM",
    description: "Home inspection CRM — Version 1 foundation.",
    other: { "app-timezone": businessTimeZone() },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request so each one gets its own CSP nonce
  // (src/proxy.ts); a page prerendered at build time would carry none and
  // its scripts would be blocked.
  await connection();
  // The viewer's appearance and palette, set on <html> before anything
  // paints; "system" is resolved by the stylesheet's prefers-color-scheme.
  const theme = parseThemeCookie((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-appearance={theme.appearance}
      data-palette={theme.palette}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
