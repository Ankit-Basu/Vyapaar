"use client";

/**
 * Shared GSAP setup for the landing page.
 *
 * Every scroll-driven effect on this page is built through `useScene`, which
 * wraps `gsap.matchMedia`. That matters for two reasons:
 *
 * 1. **Reduced motion is a real branch, not a nice-to-have.** Under
 *    `prefers-reduced-motion: reduce` the timelines are never created and the
 *    end state is applied directly, so the whole story is still legible without
 *    a single animated frame — nothing is hidden behind an animation that never
 *    plays.
 * 2. `matchMedia` owns the cleanup. Reverting it kills the ScrollTriggers,
 *    un-pins the pinned sections and restores inline styles, which is what keeps
 *    Next's client-side navigation from leaving dead triggers behind.
 */

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { cn } from "@/lib/utils";

if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, ScrollTrigger);
  if (process.env.NODE_ENV !== "production") {
    // Dev-only handle, so scroll scenes can be inspected from the console.
    (window as unknown as Record<string, unknown>).__gsap = { gsap, ScrollTrigger };
  }
}

export { gsap, ScrollTrigger };

export const EASE = "power3.out";
export const EASE_IN_OUT = "power2.inOut";

type SceneBuilders = {
  /** Runs only when the visitor has not asked for reduced motion. */
  motion: (ctx: gsap.Context) => void;
  /** Runs otherwise. Put the end state here — no tweens, just the final look. */
  still?: (ctx: gsap.Context) => void;
};

/** Build a scroll scene scoped to `scope`, with a reduced-motion fallback. */
export function useScene<T extends HTMLElement>(
  scope: RefObject<T | null>,
  { motion, still }: SceneBuilders,
  deps: unknown[] = [],
) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", (ctx) => motion(ctx));
      mm.add("(prefers-reduced-motion: reduce)", (ctx) => still?.(ctx));
      return () => mm.revert();
    },
    { scope, dependencies: deps },
  );
}

/** True once the browser reports a reduced-motion preference. Null until mounted. */
export function useReducedMotion(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/**
 * Fade-and-rise on entry, with an optional stagger over direct children.
 *
 * Deliberately opacity and transform only. A blur tween looks lovely and costs a
 * full re-rasterisation of the text on every frame, which is not a trade worth
 * making dozens of times down a scrolling page.
 */
export function Reveal({
  children,
  className,
  stagger = false,
  y = 28,
  delay = 0,
  start = "top 82%",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  stagger?: boolean;
  y?: number;
  delay?: number;
  start?: string;
  as?: "div" | "section" | "header" | "li" | "p";
}) {
  const scope = useRef<HTMLElement>(null);

  useScene(
    scope,
    {
      motion: () => {
        const targets = stagger
          ? (gsap.utils.toArray(scope.current!.children) as HTMLElement[])
          : [scope.current!];
        gsap.from(targets, {
          opacity: 0,
          y,
          duration: 0.9,
          delay,
          ease: EASE,
          stagger: stagger ? 0.09 : 0,
          scrollTrigger: { trigger: scope.current, start, once: true },
        });
      },
      still: () => {
        gsap.set(stagger ? scope.current!.children : scope.current, {
          opacity: 1,
          y: 0,
        });
      },
    },
    [stagger, y, delay, start],
  );

  return (
    // @ts-expect-error -- Tag is constrained to intrinsic elements above
    <Tag ref={scope} className={className}>
      {children}
    </Tag>
  );
}

/** Section eyebrow: a small numbered label above a heading in Kinetic style. */
export function Eyebrow({ index, children }: { index: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="size-1.5 rounded-full bg-[#ffb77b] shadow-[0_0_8px_#ffb77b]" />
      <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.32em] text-[#ffb77b]">
        {index} // {children}
      </span>
    </div>
  );
}

/** Consistent vertical rhythm and max width for every narrative section. */
export function Section({
  id,
  children,
  className,
  wide = false,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <section
      id={id}
      className={cn(
        "relative mx-auto w-full px-6 py-24 sm:px-8 md:py-32",
        wide ? "max-w-7xl" : "max-w-5xl",
        className,
      )}
    >
      {children}
    </section>
  );
}
