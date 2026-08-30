import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader, Space_Grotesk } from "next/font/google";
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

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
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
  title: "Vyapaar — agent commerce control room",
  description:
    "Live view of an AI buyer agent transacting with a Razorpay merchant: guardrail decisions, spend against mandate, and a hash-chained audit trail.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${clashDisplay.variable} ${newsreader.variable} ${spaceGrotesk.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
