"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";

import { AgentMandiLogo } from "@/components/logo";

const LINKS = [
  { href: "#problem", label: "THE PROBLEM" },
  { href: "#guardrails", label: "GUARDRAILS" },
  { href: "#audit", label: "AUDIT" },
  { href: "#mcp", label: "MCP" },
];

export function Nav() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = LINKS.map((link) =>
      document.querySelector<HTMLElement>(link.href),
    ).filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(`#${entry.target.id}`);
        }
      },
      { rootMargin: "-40% 0px -50% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full bg-[#131314]/85 backdrop-blur-md border-b border-[#444748]/15 transition-all">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6 sm:px-10 text-[11px] tracking-[0.16em]">
        {/* Brand Logo */}
        <Link href="/" className="transition hover:opacity-90">
          <AgentMandiLogo size={32} textClassName="text-lg sm:text-xl tracking-[0.16em]" />
        </Link>

        {/* Center Navigation Links */}
        <nav className="hidden md:flex items-center gap-8 text-[#b89a8e]">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`transition-colors hover:text-[#ffb77b] ${
                active === link.href ? "text-[#ffb77b] font-semibold" : "text-[#b89a8e]"
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right CTA Actions */}
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-[11px] font-semibold tracking-[0.18em] text-[#b89a8e] transition hover:text-[#ffb77b]"
          >
            LOGIN
          </Link>
          <a
            href="https://github.com/Ankit-Basu/AgentMandi"
            target="_blank"
            rel="noreferrer"
            className="grid size-8 place-items-center text-[#b89a8e] transition hover:text-[#e5e2e3]"
            aria-label="Source on GitHub"
          >
            <svg className="size-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
          <Link
            href="/dashboard"
            className="bg-gradient-to-r from-[#ffb77b] to-[#b16d2e] px-5 py-2.5 text-[11px] font-semibold tracking-[0.2em] text-[#2e1500] uppercase transition hover:brightness-110 shadow-lg flex items-center gap-1.5"
          >
            INITIALIZE
            <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
    </header>
  );
}
export default Nav;
