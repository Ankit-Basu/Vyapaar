"use client";

import { Check, Lock, ShieldCheck } from "lucide-react";
import { useRef } from "react";

import { EASE, Eyebrow, gsap, useScene } from "@/components/landing/motion";

/**
 * The eight guardrails, in the order `policy/engine.py` runs them. Kept in step
 * with `ORDERED_CHECKS` on the API — the numbers here are the real ones from the
 * happy-path scenario, not invented for the page.
 */
const CHECKS = [
  {
    id: "mandate_valid",
    name: "Mandate is signed, unexpired and on record",
    reason: "Signature, issuer and expiry verify against the merchant's own record.",
  },
  {
    id: "merchant_match",
    name: "Intent targets the merchant the mandate names",
    reason: "A mandate is not transferable between merchants.",
  },
  {
    id: "product_exists",
    name: "Product exists, and the price is the merchant's",
    reason: "₹1,299 × 1 matches the catalog. An agent cannot name its own price.",
  },
  {
    id: "category_allowed",
    name: "Category is inside the mandate allow-list",
    reason: "'electronics' was authorised by the buyer. 'fitness' would not be.",
  },
  {
    id: "per_txn_cap",
    name: "Amount is within the per-transaction cap",
    reason: "₹1,299 sits inside the ₹3,000 ceiling on any single purchase.",
  },
  {
    id: "budget_remaining",
    name: "The mandate has enough budget left",
    reason: "Budget minus spend minus money already held for in-flight purchases.",
  },
  {
    id: "stock_available",
    name: "The merchant can actually fulfil it",
    reason: "42 in stock. Charging for something unshippable is not allowed.",
  },
  {
    id: "high_value_gate",
    name: "High-value purchases need a human",
    reason: "₹1,299 is below the ₹5,000 threshold, so the agent may proceed alone.",
  },
] as const;

export function GuardrailScene() {
  const scope = useRef<HTMLElement>(null);

  useScene(scope, {
    motion: () => {
      const rows = gsap.utils.toArray<HTMLElement>(".gr-row");

      // Start every row dormant, then illuminate them one by one as the reader
      // scrolls. The scrub ties progress to scroll position rather than to time,
      // so the reader controls the pace and can scrub backwards.
      gsap.set(rows, { opacity: 0.28 });
      // Reasons keep their space and only fade: animating height would run
      // layout on every scroll frame, eight times over, inside a pinned section.
      gsap.set(".gr-reason", { opacity: 0, y: -4 });
      gsap.set(".gr-tick", { scale: 0, opacity: 0 });
      gsap.set(".gr-verdict", { opacity: 0, scale: 0.85 });

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: scope.current,
          start: "top top",
          end: `+=${CHECKS.length * 190 + 520}`,
          pin: ".gr-stage",
          scrub: 0.75,
          anticipatePin: 1,
        },
      });

      rows.forEach((row, index) => {
        const at = index * 1;
        timeline
          .to(row, { opacity: 1, duration: 0.35 }, at)
          .to(row.querySelector(".gr-index"), { color: "#2fd48f", duration: 0.3 }, at)
          .to(
            row.querySelector(".gr-tick"),
            { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(2.4)" },
            at + 0.1,
          )
          .to(
            row.querySelector(".gr-reason"),
            { opacity: 1, y: 0, duration: 0.35 },
            at + 0.12,
          )
          // The rail fills to this row's position, so the progress line tracks
          // exactly which check is currently being evaluated.
          .to(
            ".gr-rail-fill",
            { scaleY: (index + 1) / CHECKS.length, duration: 0.35, ease: "none" },
            at,
          );

        // Once a check has been read, dim it slightly so the active row leads.
        if (index > 0) {
          timeline.to(rows[index - 1], { opacity: 0.55, duration: 0.3 }, at);
        }
      });

      timeline
        .to(rows, { opacity: 1, duration: 0.4 }, CHECKS.length)
        .to(
          ".gr-verdict",
          { opacity: 1, scale: 1, duration: 0.7, ease: EASE },
          CHECKS.length + 0.1,
        )
        .to(".gr-card", { borderColor: "rgba(47,212,143,0.4)", duration: 0.5 }, CHECKS.length + 0.1);
    },

    still: () => {
      // No pinning, no scrub: show the finished evaluation.
      gsap.set(".gr-row", { opacity: 1 });
      gsap.set(".gr-reason", { opacity: 1, y: 0 });
      gsap.set(".gr-tick", { scale: 1, opacity: 1 });
      gsap.set(".gr-index", { color: "#2fd48f" });
      gsap.set(".gr-rail-fill", { scaleY: 1 });
      gsap.set(".gr-verdict", { opacity: 1, scale: 1 });
    },
  });

  return (
    <section ref={scope} id="guardrails" className="relative">
      <div className="gr-stage flex min-h-dvh items-center py-12">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 px-6 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          {/* Left: what is being decided */}
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Eyebrow index="03">The guardrail engine</Eyebrow>
            <h2 className="mt-5 text-[clamp(1.9rem,3.6vw,2.9rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
              Eight checks stand between
              <br />
              <span className="text-gradient">an agent and your money.</span>
            </h2>
            <p className="mt-5 max-w-md text-[14.5px] leading-relaxed text-mute-400">
              Every purchase intent runs the same ordered gauntlet. The first failure denies it,
              and the remaining checks are recorded as skipped rather than quietly dropped — so
              the trail shows exactly how far evaluation got, and why it stopped.
            </p>

            <div className="gr-card glass-flat-strong mt-8 rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-mute-500">
                  <Lock size={11} />
                  purchase intent
                </span>
                <span className="gr-verdict rounded-md bg-pass-bg px-2 py-0.5 text-[10px] font-bold tracking-wider text-pass-500 uppercase">
                  auto_approve
                </span>
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium text-mute-100">
                  Aurora Wireless Optical Mouse
                </span>
                <span className="font-mono text-[16px] font-semibold tabular-nums">
                  ₹1,299.00
                </span>
              </div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-mute-500">
                Raised by the buyer agent under a mandate capped at ₹3,000 per purchase, inside a
                ₹10,000 budget, limited to electronics and office.
              </p>
            </div>
          </div>

          {/* Right: the checks running */}
          <div className="relative">
            {/* Rail: a track with a fill that tracks evaluation progress. */}
            <div className="absolute top-2 bottom-2 left-[13px] w-px bg-white/10" />
            <div className="gr-rail-fill absolute top-2 bottom-2 left-[13px] w-px origin-top scale-y-0 bg-gradient-to-b from-pass-500 via-pass-500 to-brand-400" />

            <ol className="space-y-2.5">
              {CHECKS.map((check, index) => (
                <li key={check.id} className="gr-row relative flex gap-4 pl-0">
                  <span className="relative z-10 grid size-[27px] shrink-0 place-items-center rounded-full border border-white/10 bg-ink-900">
                    <span className="gr-tick absolute inset-0 grid place-items-center rounded-full bg-pass-bg">
                      <Check size={12} className="text-pass-500" strokeWidth={3.5} />
                    </span>
                    <span className="gr-index font-mono text-[11px] font-semibold text-mute-500">
                      {index + 1}
                    </span>
                  </span>

                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-[12px] text-brand-300">{check.id}</span>
                      <span className="text-[13px] font-medium text-mute-200">{check.name}</span>
                    </div>
                    <div className="gr-reason">
                      <p className="pt-0.5 text-[11.5px] leading-snug text-mute-500">
                        {check.reason}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            <div className="gr-verdict glass-flat mt-6 flex items-center gap-3 rounded-xl px-4 py-3">
              <ShieldCheck size={16} className="shrink-0 text-pass-500" />
              <p className="text-[12.5px] leading-relaxed text-mute-300">
                All eight passed. Only now may the payment service open a Razorpay order — and
                the purchase still will not settle until a webhook arrives whose signature
                verifies.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
