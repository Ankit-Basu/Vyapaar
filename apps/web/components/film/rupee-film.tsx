"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, useState } from "react";

import { useFrameSequence } from "@/components/film/use-frame-sequence";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

/**
 * The film, chaptered.
 *
 * One continuous 10-second shot, 240 frames, scrubbed by scroll.
 *
 * The boundaries are measured, not guessed. Sampling every sixth frame for
 * cyan-dominant pixels (the cool light) and for specular brightness (the metal)
 * gives the footage's own curve:
 *
 *   0.00-0.30  dark, the coin edge-on and turning
 *   0.33       the metal at its brightest — the face has caught the key light
 *   0.35-0.40  cool light begins to gather at the rim
 *   0.42-0.72  that rim sustained, the long steady middle
 *   0.80       the bloom peaks, four times brighter than the rim
 *   0.86-1.00  released, settling, at rest
 *
 * Those are the mandate, the guardrails, the verdict and the record. An earlier
 * cut put the bloom exactly on a chapter boundary, so the verdict caption
 * arrived after the verdict had already happened; the ranges below hold each
 * beat inside the chapter that names it.
 */
const CHAPTERS = [
  {
    at: 0.0,
    to: 0.3,
    eyebrow: "Agent commerce",
    title: "Let an AI agent\nspend your money.",
    body: "Not a chatbot inside your app. An outside agent that discovers your catalogue, prices it, and buys — on its own.",
  },
  {
    at: 0.3,
    to: 0.42,
    eyebrow: "The mandate",
    title: "Consent once.",
    body: "A person signs one authorisation carrying a per-purchase cap, a total budget, a category allow-list and an expiry. The token carries scope, never spend.",
  },
  {
    at: 0.42,
    to: 0.72,
    eyebrow: "The guardrails",
    title: "Eight checks,\nin order, every time.",
    body: "Identity and authorisation before bounds, bounds before fulfilment, the human gate last — so it only ever fires on an otherwise-clean buy.",
  },
  {
    at: 0.72,
    to: 0.86,
    eyebrow: "The verdict",
    title: "Bounded, or it\ndoes not happen.",
    body: "Auto-approve, hold for a human, or deny with the exact arithmetic that failed. A refusal the agent can act on, not a shrug.",
  },
  {
    at: 0.86,
    to: 0.96,
    eyebrow: "The record",
    title: "Every rupee,\nwritten down.",
    body: "Each decision lands in an append-only hash chain. Edit one row and every row after it stops verifying.",
  },
  {
    at: 0.96,
    to: 1.0,
    eyebrow: "Razorpay test mode",
    title: "Watch it happen live.",
    body: "The control room streams every guardrail decision, budget movement and audit row as it happens.",
  },
] as const;

export function RupeeFilm() {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { ready, draw, lastProgress } = useFrameSequence("rupee");
  const [chapter, setChapter] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);

  /*
   * The scrub.
   *
   * Deliberately does not depend on `chapter`: the chapter is an *output* of
   * scrolling, and listing it here would tear down and rebuild the
   * ScrollTrigger on every boundary the reader crosses.
   */
  useEffect(() => {
    if (!ready || reduced || !root.current) return;

    const state = { p: 0 };
    const ctx = gsap.context(() => {
      gsap.to(state, {
        p: 1,
        ease: "none",
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: "bottom bottom",
          scrub: 0.55,
          onUpdate: (self) => {
            draw(canvas.current, self.progress);
            const found = CHAPTERS.findIndex(
              (c) => self.progress >= c.at && self.progress < c.to,
            );
            const next = found === -1 ? CHAPTERS.length - 1 : found;
            setChapter((current) => (current === next ? current : next));
          },
        },
      });
    }, root);

    draw(canvas.current, 0);
    return () => ctx.revert();
  }, [ready, reduced, draw]);

  /*
   * Reduced motion still gets the film, just not scrubbed.
   *
   * One plain trigger per chapter advances the story on enter, and the canvas
   * shows the single frame that chapter was written against. Nothing tweens
   * and nothing tracks the scrollbar, but the whole story is still reachable —
   * which a static hero image alone would not be.
   */
  useEffect(() => {
    if (!ready || !reduced || !root.current) return;
    const ctx = gsap.context(() => {
      CHAPTERS.forEach((c, i) => {
        ScrollTrigger.create({
          trigger: root.current,
          start: `top+=${c.at * 100}% top`,
          end: `top+=${c.to * 100}% top`,
          onEnter: () => setChapter(i),
          onEnterBack: () => setChapter(i),
        });
      });
    }, root);
    return () => ctx.revert();
  }, [ready, reduced]);

  // Under reduced motion the chapter is the input, so redraw when it changes.
  useEffect(() => {
    if (!ready || !reduced) return;
    draw(canvas.current, CHAPTERS[chapter].at);
  }, [ready, reduced, chapter, draw]);

  // A resize changes the canvas backing store, which clears it. Redraw at the
  // playhead the sequence already tracks rather than snapping back to frame 0.
  useEffect(() => {
    if (!ready) return;
    const onResize = () => draw(canvas.current, lastProgress.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [ready, draw, lastProgress]);

  const active = CHAPTERS[chapter];

  return (
    <div ref={root} className="relative h-[620vh]">
      <div className="sticky top-0 flex h-dvh items-center overflow-hidden">
        {/* The film. Contain-fit and masked at the edges so the void in the
            footage becomes the page's own background rather than a rectangle
            sitting on it. */}
        <canvas
          ref={canvas}
          className="film-canvas absolute inset-0 size-full"
          aria-hidden
        />
        <div className="film-vignette pointer-events-none absolute inset-0" aria-hidden />

        {!ready && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="font-mono text-[11px] tracking-[0.2em] text-mute-500 uppercase">
              loading the film…
            </span>
          </div>
        )}

        {/* Copy sits in the footage's negative space: left on wide screens,
            bottom on narrow ones, never over the coin. */}
        <div className="relative mx-auto w-full max-w-7xl px-6 sm:px-10">
          <div
            key={chapter}
            className="film-copy max-w-lg lg:max-w-xl"
            aria-live="polite"
          >
            <p className="font-mono text-[11px] tracking-[0.22em] text-brand-300 uppercase">
              {active.eyebrow}
            </p>
            <h2 className="font-display mt-5 text-[clamp(2.1rem,5vw,4rem)] leading-[1.02] font-semibold tracking-[-0.035em] whitespace-pre-line text-mute-100">
              {active.title}
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-mute-300">
              {active.body}
            </p>

            {chapter === CHAPTERS.length - 1 && (
              <a
                href="/dashboard"
                className="lift mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-mute-100 px-6 text-[14px] font-semibold text-ink-950 shadow-xl shadow-black/40"
              >
                Open the control room →
              </a>
            )}
          </div>

          {/* Where you are in the film. */}
          <ol className="mt-10 flex items-center gap-2" aria-label="Chapters">
            {CHAPTERS.map((c, i) => (
              <li key={c.eyebrow}>
                <span
                  className="block h-0.5 rounded-full transition-all duration-500"
                  style={{
                    width: i === chapter ? 34 : 16,
                    background:
                      i === chapter ? "var(--color-brand-400)" : "rgba(255,255,255,0.18)",
                  }}
                />
                <span className="sr-only">{c.eyebrow}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
