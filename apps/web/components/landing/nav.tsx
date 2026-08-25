"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { cn } from "@/lib/utils";
import { EASE, gsap, useScene } from "@/components/landing/motion";

const LINKS = [
  { href: "#problem", label: "The problem" },
  { href: "#guardrails", label: "Guardrails" },
  { href: "#audit", label: "Audit" },
  { href: "#mcp", label: "MCP" },
];

export function Nav() {
  const scope = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  const progress = useRef<HTMLDivElement>(null);

  useScene(scope, {
    motion: () => {
      // The bar is invisible over the hero and slides in once the hero is behind us.
      gsap.set(bar.current, { yPercent: -110, opacity: 0 });
      ScrollTriggerShow(bar.current!);

      // A hairline that tracks how far through the page the reader is.
      gsap.to(progress.current, {
        scaleX: 1,
        ease: "none",
        scrollTrigger: { start: 0, end: "max", scrub: 0.3 },
      });
    },
    still: () => {
      gsap.set(bar.current, { yPercent: 0, opacity: 1 });
      gsap.set(progress.current, { scaleX: 0 });
    },
  });

  return (
    <div ref={scope}>
      <header
        ref={bar}
        className="glass fixed inset-x-0 top-0 z-50 border-x-0 border-t-0 will-change-transform"
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-5 sm:px-8">
          <Link href="#top" className="flex items-center gap-2.5" onClick={smoothTo("#top")}>
            <Mark />
            <span className="text-[13.5px] font-semibold tracking-tight">AgentMandi</span>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={smoothTo(link.href)}
                className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-mute-400 transition-colors hover:bg-white/5 hover:text-mute-100"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <a
              href="https://github.com/Ankit-Basu/AgentMandi"
              target="_blank"
              rel="noreferrer"
              className="grid size-8 place-items-center rounded-lg text-mute-400 transition-colors hover:bg-white/5 hover:text-mute-100"
              aria-label="Source on GitHub"
            >
              <GithubMark className="size-[15px]" />
            </a>
            <Link
              href="/dashboard"
              className="group inline-flex h-8 items-center gap-1 rounded-lg bg-mute-100 px-3 text-[12.5px] font-semibold text-ink-950 transition-transform hover:scale-[1.03]"
            >
              Open the dashboard
              <ArrowUpRight
                size={13}
                className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </div>
        </div>

        <div
          ref={progress}
          className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-gradient-to-r from-brand-500 via-brand-400 to-violet-400"
        />
      </header>
    </div>
  );
}

/** Slide the bar in once the hero has scrolled past. */
function ScrollTriggerShow(target: HTMLElement) {
  gsap.to(target, {
    yPercent: 0,
    opacity: 1,
    duration: 0.45,
    ease: EASE,
    scrollTrigger: {
      trigger: document.documentElement,
      start: "top+=88vh top",
      toggleActions: "play none none reverse",
    },
  });
}

/**
 * Anchor scrolling in JS rather than CSS `scroll-behavior`, which would fight
 * ScrollTrigger's scrub calculations for the whole page.
 */
function smoothTo(hash: string) {
  return (event: React.MouseEvent) => {
    const target =
      hash === "#top" ? document.body : document.querySelector<HTMLElement>(hash);
    if (!target) return;
    event.preventDefault();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };
}

export function Mark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-[13px] font-bold text-white shadow-lg shadow-brand-500/25",
        className,
      )}
    >
      ₹
    </span>
  );
}

/**
 * The GitHub mark, inlined: lucide-react v1 dropped brand icons, and a generic
 * "external link" glyph would not read as "the source is on GitHub".
 */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
