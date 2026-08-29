"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

/** The eight checks, in the order `policy/engine.py` actually runs them. */
const CHECKS = [
  ["mandate_valid", "Signature, issuer and expiry all verify."],
  ["merchant_match", "The intent targets the merchant the mandate names."],
  ["product_exists", "The product is really in this merchant's catalogue."],
  ["category_allowed", "Its category is on the buyer's allow-list."],
  ["per_txn_cap", "The amount is inside the per-purchase cap."],
  ["budget_remaining", "The mandate still has the money to cover it."],
  ["stock_available", "The merchant can actually fulfil the order."],
  ["high_value_gate", "Above the threshold, a person decides."],
] as const;

const FAILURES = [
  {
    t: "Budget exhausted",
    b: "The denial names the shortfall in rupees, not just 'insufficient funds'. The agent re-searches under what is actually left and comes back with a cheaper item.",
  },
  {
    t: "Card declined",
    b: "The intent goes FAILED and the budget hold is released. A charge that did not succeed never consumes the buyer's budget.",
  },
  {
    t: "Forged mandate",
    b: "A token edited to raise its own cap fails signature verification before a single bound is even consulted.",
  },
];

/**
 * Everything after the film.
 *
 * Plain scroll reveals rather than scrub timelines — the pinned, scrubbed
 * treatment is what makes the film feel like an event, and using it again down
 * here would spend that effect on a specification table.
 */
export function StoryOutro() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const ctx = gsap.context(() => {
        gsap.utils.toArray<HTMLElement>(".reveal").forEach((el) => {
          gsap.from(el, {
            opacity: 0,
            y: 26,
            duration: 0.8,
            ease: "power3.out",
            scrollTrigger: { trigger: el, start: "top 82%", once: true },
          });
        });
      }, root);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, []);

  return (
    <div ref={root} className="relative">
      <Section>
        <Eyebrow>The gauntlet</Eyebrow>
        <h2 className="reveal font-display mt-5 max-w-3xl text-[clamp(1.9rem,3.6vw,2.9rem)] leading-[1.04] font-semibold tracking-[-0.03em] text-mute-100">
          The eight panes the coin passed through.
        </h2>
        <p className="reveal mt-5 max-w-2xl text-[15px] leading-relaxed text-mute-400">
          Ordered so that identity and authorisation are settled before any bound is
          consulted, and the human gate fires last — only on a purchase that is otherwise
          already clean.
        </p>

        <ol className="reveal mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-2">
          {CHECKS.map(([id, why], i) => (
            <li key={id} className="bg-canvas/85 px-5 py-4 backdrop-blur-sm">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] tabular-nums text-brand-400">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-mono text-[12.5px] text-mute-100">{id}</span>
              </div>
              <p className="mt-1.5 pl-8 text-[12.5px] leading-relaxed text-mute-400">{why}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <Eyebrow>When it goes wrong</Eyebrow>
        <h2 className="reveal font-display mt-5 max-w-3xl text-[clamp(1.9rem,3.6vw,2.9rem)] leading-[1.04] font-semibold tracking-[-0.03em] text-mute-100">
          A refusal should teach the agent something.
        </h2>
        <div className="reveal mt-12 grid gap-4 md:grid-cols-3">
          {FAILURES.map((f) => (
            <div
              key={f.t}
              className="glass-surface glass-d2 pane-interactive rounded-2xl p-6"
            >
              <h3 className="text-[14px] font-semibold text-mute-100">{f.t}</h3>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-mute-400">{f.b}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section className="pb-40 text-center">
        <h2 className="reveal font-display mx-auto max-w-2xl text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[1.02] font-semibold tracking-[-0.04em] text-mute-100">
          Nothing here was mocked.
        </h2>
        <p className="reveal mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-mute-400">
          Seven scripted scenarios run the real services — three of them failures, handled.
          Razorpay test mode only; the config refuses any key that is not a test key.
        </p>
        <div className="reveal mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="lift inline-flex h-12 items-center gap-2 rounded-xl bg-mute-100 px-6 text-[14px] font-semibold text-ink-950 shadow-xl shadow-black/40"
          >
            Open the control room →
          </Link>
          <Link
            href="/"
            className="glass-surface glass-d1 lift inline-flex h-12 items-center rounded-xl px-6 text-[14px] font-medium text-mute-200"
          >
            Read the overview
          </Link>
        </div>
      </Section>
    </div>
  );
}

function Section({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={`mx-auto w-full max-w-6xl px-6 py-28 sm:px-10 md:py-36 ${className ?? ""}`}>
      {children}
    </section>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="reveal font-mono text-[11px] tracking-[0.22em] text-brand-300 uppercase">
      {children}
    </p>
  );
}
