"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { Mark } from "@/components/brand";
import { ThemeSwitcher } from "@/components/glass/theme";
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
  const [active, setActive] = useState<string | null>(null);

  /*
   * Which section the reader is actually in.
   *
   * An observer rather than a ScrollTrigger: knowing where you are is
   * orientation, not decoration, so it has to keep working for a visitor who
   * has asked for reduced motion — and `useScene` deliberately never builds
   * triggers for them.
   */
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
      // A thin band across the middle of the viewport: whatever crosses it wins,
      // so exactly one link is lit at a time.
      { rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useScene(scope, {
    motion: () => {
      // The bar enters smoothly on mount and stays accessible
      gsap.from(bar.current, { yPercent: -100, opacity: 0, duration: 0.6, ease: EASE });

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
        className="fixed inset-x-0 top-0 z-50 px-3 pt-3 will-change-transform sm:px-6 sm:pt-4"
      >
        <div className="glass-surface glass-d3 glass-specular-edge relative mx-auto flex h-14 max-w-7xl items-center gap-5 rounded-2xl px-4 sm:px-5">
          <Link href="#top" className="flex items-center gap-2.5" onClick={smoothTo("#top")}>
            <Mark />
            <span className="u-display text-[15px] tracking-tight">AgentMandi</span>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={smoothTo(link.href)}
                aria-current={active === link.href ? "true" : undefined}
                className={cn(
                  "u-focus-ring relative rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                  active === link.href
                    ? "text-heading"
                    : "text-caption hover:bg-white/[0.05] hover:text-body",
                )}
              >
                {link.label}
                {/* The active section gets a lit underline rather than a filled
                    pill, so the bar stays quiet while still answering "where am I". */}
                {active === link.href && (
                  <span
                    className="absolute inset-x-2 -bottom-px h-px rounded-full"
                    style={{
                      background: "var(--color-accent)",
                      boxShadow: "0 0 8px 0 var(--color-accent)",
                    }}
                    aria-hidden
                  />
                )}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeSwitcher />
            <a
              href="https://github.com/Ankit-Basu/AgentMandi"
              target="_blank"
              rel="noreferrer"
              className="u-focus-ring grid size-9 place-items-center rounded-xl text-caption transition-colors hover:bg-white/[0.06] hover:text-heading"
              aria-label="Source on GitHub"
            >
              <GithubMark className="size-[15px]" />
            </a>
            <Link
              href="/dashboard"
              className="u-focus-ring skeu skeu-gloss group inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold text-canvas"
              style={{ background: "var(--color-accent)" }}
            >
              Open the dashboard
              <ArrowUpRight
                size={13}
                className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </div>

          {/* How far through the page the reader is, hugging the pill's own
              edge rather than spanning the padded wrapper around it. */}
          <div
            ref={progress}
            className="absolute inset-x-5 bottom-0.5 h-px origin-left scale-x-0 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--color-accent), var(--color-accent-text))",
            }}
          />
        </div>
      </header>
    </div>
  );
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

export { Mark };
