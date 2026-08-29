"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, useState } from "react";

import { useFrameSequence } from "@/components/film/use-frame-sequence";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

/**
 * The film, chaptered.
 *
 * One continuous shot — 242 frames (coin hero still + 240 video frames +
 * coin closing still), scrubbed by scroll.
 *
 * Frame 1 is the clean anchor coin image (liquid mercury ₹ coin in void).
 * Frames 2–241 are extracted from the cinematic video at 24fps with the
 * Gemini watermark cropped. Frame 242 is the coin image again for the CTA.
 *
 * The chapter boundaries are calibrated to the footage's visual beats:
 *   0.00–0.18  coin still, then the coin rotates into view — genesis
 *   0.18–0.36  the coin catches the key light — the mandate/consent
 *   0.36–0.64  the long steady middle — the guardrail gauntlet
 *   0.64–0.80  the bloom peaks — the verdict settles
 *   0.80–0.93  released, settling — the ledger/record
 *   0.93–1.00  at rest on the coin still — the CTA
 */
const CHAPTERS = [
  {
    at: 0.0,
    to: 0.18,
    eyebrow: "Agent commerce",
    title: "Let an AI agent\nspend your money.",
    body: "Not a chatbot inside your app. An outside agent that discovers your catalogue, prices it, and buys — on its own.",
  },
  {
    at: 0.18,
    to: 0.36,
    eyebrow: "The mandate",
    title: "Consent once.",
    body: "A person signs one authorisation carrying a per-purchase cap, a total budget, a category allow-list and an expiry. The token carries scope, never spend.",
  },
  {
    at: 0.36,
    to: 0.64,
    eyebrow: "The guardrails",
    title: "Eight checks,\nin order, every time.",
    body: "Identity and authorisation before bounds, bounds before fulfilment, the human gate last — so it only ever fires on an otherwise-clean buy.",
  },
  {
    at: 0.64,
    to: 0.80,
    eyebrow: "The verdict",
    title: "Bounded, or it\ndoes not happen.",
    body: "Auto-approve, hold for a human, or deny with the exact arithmetic that failed. A refusal the agent can act on, not a shrug.",
  },
  {
    at: 0.80,
    to: 0.93,
    eyebrow: "The record",
    title: "Every rupee,\nwritten down.",
    body: "Each decision lands in an append-only hash chain. Edit one row and every row after it stops verifying.",
  },
  {
    at: 0.93,
    to: 1.0,
    eyebrow: "Razorpay test mode",
    title: "Watch it happen live.",
    body: "The control room streams every guardrail decision, budget movement and audit row as it happens.",
  },
] as const;

export function RupeeFilm() {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const progressBar = useRef<HTMLDivElement>(null);
  const { ready, draw, lastProgress } = useFrameSequence("rupee");
  const [chapter, setChapter] = useState(0);
  const [reduced, setReduced] = useState(false);
  const prevChapter = useRef(0);

  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);

  /*
   * The scrub — the core scroll-driven animation.
   *
   * Does not depend on `chapter`: the chapter is an *output* of scrolling.
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
          scrub: 0.3,
          onUpdate: (self) => {
            draw(canvas.current, self.progress);
            // Update progress bar directly via DOM for 60fps smoothness
            if (progressBar.current) {
              progressBar.current.style.width = `${self.progress * 100}%`;
            }
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
   * Smooth chapter text crossfade.
   * When chapter changes, animate out old copy and animate in new copy.
   */
  useEffect(() => {
    if (!copyRef.current) return;
    if (prevChapter.current === chapter) return;

    const el = copyRef.current;
    const tl = gsap.timeline();

    tl.to(el, {
      opacity: 0,
      y: -10,
      duration: 0.2,
      ease: "power2.in",
      onComplete: () => {
        prevChapter.current = chapter;
      },
    }).fromTo(
      el,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" },
    );

    return () => { tl.kill(); };
  }, [chapter]);

  /*
   * Reduced motion: static frames per chapter, no scrub.
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

  useEffect(() => {
    if (!ready || !reduced) return;
    draw(canvas.current, CHAPTERS[chapter].at);
  }, [ready, reduced, chapter, draw]);

  // Redraw on resize at the current playhead position.
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
        {/* The film canvas — contain-fit and masked at the edges so the void
            in the footage becomes the page's own background. */}
        <canvas
          ref={canvas}
          className="film-canvas absolute inset-0 size-full"
          aria-hidden
        />
        <div className="film-vignette pointer-events-none absolute inset-0" aria-hidden />
        {/* Corner mask to hide the Gemini sparkle watermark in the bottom-right */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(ellipse 25% 20% at 88% 90%, rgba(5,7,15,0.95) 0%, rgba(5,7,15,0.7) 40%, transparent 100%)",
          }}
          aria-hidden
        />

        {/* Loading state shows the coin image path as a static preview */}
        {!ready && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-4">
              <span className="animate-pulse font-mono text-[11px] tracking-[0.2em] text-mute-400 uppercase">
                loading the film…
              </span>
            </div>
          </div>
        )}

        {/* Copy sits in the footage's negative space: left on wide screens,
            bottom on narrow ones, never over the coin. */}
        <div className="relative mx-auto w-full max-w-7xl px-6 sm:px-10">
          <div
            ref={copyRef}
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
                className="lift mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-mute-100 px-6 text-[14px] font-semibold text-ink-950 shadow-xl shadow-black/40 transition-transform hover:scale-105"
              >
                Open the control room →
              </a>
            )}
          </div>

          {/* Chapter progress indicator */}
          <ol className="mt-10 flex items-center gap-2.5" aria-label="Chapters">
            {CHAPTERS.map((c, i) => (
              <li key={c.eyebrow}>
                <span
                  className="block rounded-full transition-all duration-500"
                  style={{
                    width: i === chapter ? 36 : 14,
                    height: i === chapter ? 3 : 2,
                    background:
                      i === chapter ? "var(--color-brand-400)" : "rgba(255,255,255,0.15)",
                    boxShadow:
                      i === chapter ? "0 0 8px var(--color-brand-400)" : "none",
                  }}
                />
                <span className="sr-only">{c.eyebrow}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Scroll progress bar at the very bottom of the viewport */}
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/[0.06]">
          <div
            ref={progressBar}
            className="h-full bg-gradient-to-r from-brand-500/60 to-brand-400/80"
            style={{ width: "0%" }}
          />
        </div>
      </div>
    </div>
  );
}
