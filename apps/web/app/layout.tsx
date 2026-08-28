import type { Metadata } from "next";
import Script from "next/script";

import { THEME_INIT_SCRIPT } from "@/components/glass/theme";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/*
 * Clash Display, self-hosted. One 29 KB variable file covers 200-700, so the
 * display face costs a single request and no layout shift on weight changes.
 * Fontshare Free License, copied to public/fonts alongside the font.
 */
const clashDisplay = localFont({
  src: "../public/fonts/ClashDisplay-Variable.woff2",
  variable: "--font-clash-display",
  weight: "200 700",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AgentMandi — agent commerce control room",
  description:
    "Live view of an AI buyer agent transacting with a Razorpay merchant: guardrail decisions, spend against mandate, and a hash-chained audit trail.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${clashDisplay.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/*
          Applies the saved palette before any Next.js module runs, so a visitor
          who picked one never sees the default flash first.

          It sits inside <body> rather than beside it because `<script>` is not a
          legal child of `<html>` — placing it there produced a hydration error.
          Next hoists every `beforeInteractive` script into <head> regardless of
          where it is written, so the position here costs nothing.
        */}
        <Script id="agentmandi-theme" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        {children}
      </body>
    </html>
  );
}
