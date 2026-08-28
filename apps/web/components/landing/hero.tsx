"use client";

import { ArrowRight, Check, Lock, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { EASE, gsap, useScene } from "@/components/landing/motion";

const HEADLINE_A = "Let an AI agent".split(" ");
const HEADLINE_B = "spend your money.".split(" ");

export function Hero() {
  const scope = useRef<HTMLElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useScene(scope, {
    motion: () => {
      const intro = gsap.timeline({ defaults: { ease: EASE } });

      intro
        .from(".hero-badge", { opacity: 0, y: 16, duration: 0.7 })
        .from(
          ".hero-word",
          { opacity: 0, yPercent: 115, rotateX: -55, duration: 0.9, stagger: 0.045 },
          "-=0.4",
        )
        .from(".hero-sub", { opacity: 0, y: 20, duration: 0.8 }, "-=0.5")
        .from(".hero-cta", { opacity: 0, y: 16, duration: 0.7, stagger: 0.08 }, "-=0.5")
        .from(
          card.current,
          { opacity: 0, y: 48, rotateX: 14, scale: 0.94, duration: 1.1 },
          "-=0.75",
        )
        .from(".hero-check", { opacity: 0, x: -12, duration: 0.45, stagger: 0.07 }, "-=0.55")
        .from(".hero-hint", { opacity: 0, duration: 0.6 }, "-=0.2");

      // Leaving the hero reads as a camera pulling back: the content recedes and
      // dims while the grid floor drifts at a different rate.
      gsap.to(content.current, {
        y: -60,
        scale: 0.94,
        opacity: 0,
        ease: "none",
        scrollTrigger: {
          trigger: scope.current,
          start: "top top",
          end: "bottom top",
          scrub: 0.6,
        },
      });
      gsap.to(grid.current, {
        yPercent: 22,
        opacity: 0.25,
        ease: "none",
        scrollTrigger: {
          trigger: scope.current,
          start: "top top",
          end: "bottom top",
          scrub: 0.6,
        },
      });
    },
    still: () => {
      gsap.set(
        [".hero-badge", ".hero-word", ".hero-sub", ".hero-cta", ".hero-check", ".hero-hint", card.current],
        { opacity: 1, y: 0, x: 0, scale: 1, rotateX: 0, yPercent: 0 },
      );
    },
  });

  return (
    <section
      ref={scope}
      id="top"
      className="relative flex min-h-dvh items-center overflow-hidden pt-24 pb-16"
    >
      <div ref={grid} className="grid-floor pointer-events-none absolute inset-0 -z-10" />

      {/* Floating orbs for visual depth */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div
          className="absolute top-[15%] left-[8%] size-64 rounded-full opacity-20"
          style={{
            background: "radial-gradient(circle, var(--color-brand-500), transparent 70%)",
            animation: "float-up 8s ease-in-out infinite",
          }}
        />
        <div
          className="absolute right-[12%] bottom-[25%] size-48 rounded-full opacity-15"
          style={{
            background: "radial-gradient(circle, var(--color-violet-400), transparent 70%)",
            animation: "float-up 10s ease-in-out 2s infinite",
          }}
        />
        <div
          className="absolute top-[55%] left-[45%] size-36 rounded-full opacity-10"
          style={{
            background: "radial-gradient(circle, var(--color-brand-300), transparent 70%)",
            animation: "float-up 12s ease-in-out 4s infinite",
          }}
        />
      </div>

      <div
        ref={content}
        className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-6 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16"
      >
        <div style={{ perspective: 800 }}>
          <div className="hero-badge glass-flat inline-flex items-center gap-2 rounded-full px-3 py-1.5">
            <Sparkles size={12} className="text-brand-400" />
            <span className="text-[11.5px] font-medium tracking-wide text-mute-300">
              Razorpay Buildathon · Agent Commerce Layer
            </span>
          </div>

          <h1 className="font-display mt-6 text-[clamp(2.6rem,6.6vw,4.8rem)] leading-[0.94] font-semibold tracking-[-0.04em]">
            <span className="block overflow-hidden pb-1">
              {HEADLINE_A.map((word, i) => (
                <span key={i} className="hero-word mr-[0.28em] inline-block">
                  {word}
                </span>
              ))}
            </span>
            <span className="block overflow-hidden pb-1">
              {HEADLINE_B.map((word, i) => (
                <span key={i} className="hero-word text-gradient-shimmer mr-[0.28em] inline-block">
                  {word}
                </span>
              ))}
            </span>
          </h1>

          <p className="hero-sub mt-6 max-w-xl text-[15px] leading-relaxed text-mute-400">
            AgentMandi turns any Razorpay merchant into something an external AI agent can
            discover, price and buy from — on its own. Every rupee it moves is{" "}
            <strong className="font-medium text-mute-200">bounded</strong> by a signed mandate,{" "}
            <strong className="font-medium text-mute-200">gated</strong> when it matters, and{" "}
            <strong className="font-medium text-mute-200">explained</strong> in a tamper-evident
            audit trail.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="hero-cta lift group relative inline-flex h-11 items-center gap-2 overflow-hidden rounded-xl bg-mute-100 px-5 text-[13.5px] font-semibold text-ink-950 shadow-xl shadow-black/40"
            >
              <span className="relative z-10 flex items-center gap-2">
                Watch an agent buy something
                <ArrowRight
                  size={15}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </span>
            </Link>
            <a
              href="#guardrails"
              className="hero-cta glass-flat lift inline-flex h-11 items-center gap-2 rounded-xl px-5 text-[13.5px] font-medium text-mute-200 hover:border-white/20 hover:text-white"
            >
              <ShieldCheck size={15} className="text-brand-400" />
              See the guardrails
            </a>
          </div>

          {/* Trust badges */}
          <div className="hero-cta mt-6 flex flex-wrap items-center gap-4 text-[10.5px] text-mute-500">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-pass-500" />
              Razorpay test mode
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-brand-400" />
              MCP compatible
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-violet-400" />
              Open source
            </span>
          </div>
        </div>

        {/* The product's soul in one card: a real decision, with its reasons. */}
        <div style={{ perspective: 1100 }} className="relative">
          <div
            className="pointer-events-none absolute -inset-10 -z-10"
            style={{
              background:
                "radial-gradient(55% 50% at 50% 45%, color-mix(in srgb, var(--color-brand-500) 28%, transparent), transparent 72%)",
            }}
            aria-hidden
          />

          <div
            ref={card}
            className="glass-flat-strong animate-float-card relative overflow-hidden rounded-2xl p-6 will-change-transform"
          >
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="animate-sheen absolute inset-y-0 -left-1/4 w-1/3 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Lock size={12} className="text-mute-500" />
                <span className="font-mono text-[10.5px] text-mute-500">
                  int_9f3a…c21b
                </span>
              </div>
              <span className="glow-pulse rounded-md bg-pass-bg px-2 py-0.5 text-[10px] font-bold tracking-wider text-pass-500 uppercase">
                auto_approve
              </span>
            </div>

            <div className="mt-4 flex items-baseline justify-between gap-3">
              <div>
                <div className="text-[13.5px] font-medium text-mute-100">
                  Aurora Wireless Optical Mouse
                </div>
                <div className="mt-0.5 text-[11px] text-mute-500">
                  chosen by the agent · electronics
                </div>
              </div>
              <div className="font-mono text-[19px] font-semibold tabular-nums">₹1,299.00</div>
            </div>

            <div className="rule-fade my-4" />

            <ul className="space-y-2">
              {HERO_CHECKS.map((check) => (
                <li key={check.id} className="hero-check flex items-start gap-2.5">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-pass-bg">
                    <Check size={9} className="text-pass-500" strokeWidth={3.5} />
                  </span>
                  <span className="min-w-0">
                    <span className="text-[11.5px] font-medium text-mute-200">{check.id}</span>
                    <span className="block text-[11px] leading-snug text-mute-500">
                      {check.reason}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4 rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-[10.5px] leading-relaxed text-mute-500">
                Eight guardrails, in order, every time. The agent never touches the payment
                service directly.
              </p>
            </div>
          </div>
        </div>
      </div>

      <a
        href="#problem"
        className="hero-hint absolute bottom-7 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5 text-mute-500 transition-colors hover:text-mute-300"
      >
        <span className="text-[10px] font-medium tracking-[0.2em] uppercase">Scroll</span>
        <span className="animate-scroll-hint block h-6 w-px bg-gradient-to-b from-mute-500 to-transparent" />
      </a>
    </section>
  );
}

const HERO_CHECKS = [
  { id: "mandate_valid", reason: "Signature, issuer and expiry all verify." },
  { id: "category_allowed", reason: "'electronics' is on the buyer's allow-list." },
  { id: "per_txn_cap", reason: "₹1,299 sits inside the ₹3,000 per-purchase cap." },
  { id: "budget_remaining", reason: "₹8,701 would remain of the ₹10,000 budget." },
];
