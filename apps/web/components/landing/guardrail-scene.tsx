"use client";

import { Check, Lock, ShieldCheck } from "lucide-react";
import { useRef } from "react";
import { Eyebrow, gsap, useScene } from "@/components/landing/motion";

const CHECKS = [
  {
    id: "mandate_valid",
    num: 1,
    name: "Mandate is signed, unexpired and on record",
    reason: "Signature, issuer and expiry verify against the merchant's own record.",
  },
  {
    id: "merchant_match",
    num: 2,
    name: "Intent targets the merchant the mandate names",
    reason: "A mandate is not transferable between merchants.",
  },
  {
    id: "product_exists",
    num: 3,
    name: "Product exists, and the price is the merchant's",
    reason: "₹1,299 × 1 matches the catalog. An agent cannot name its own price.",
  },
  {
    id: "category_allowed",
    num: 4,
    name: "Category is inside the mandate allow-list",
    reason: "'electronics' was authorised by the buyer. 'fitness' would not be.",
  },
  {
    id: "per_txn_cap",
    num: 5,
    name: "Amount is within the per-transaction cap",
    reason: "₹1,299 sits inside the ₹3,000 ceiling on any single purchase.",
  },
  {
    id: "budget_remaining",
    num: 6,
    name: "The mandate has enough budget left",
    reason: "Budget minus spend minus money already held for in-flight purchases.",
  },
  {
    id: "stock_available",
    num: 7,
    name: "The merchant can actually fulfil it",
    reason: "42 in stock. Charging for something unshippable is not allowed.",
  },
  {
    id: "high_value_gate",
    num: 8,
    name: "High-value purchases need a human",
    reason: "₹1,299 is below the ₹5,000 threshold, so the agent may proceed alone.",
  },
] as const;

export function GuardrailScene() {
  const scope = useRef<HTMLElement>(null);

  useScene(scope, {
    motion: () => {
      const rows = gsap.utils.toArray<HTMLElement>(".gr-row");
      const ticks = gsap.utils.toArray<HTMLElement>(".gr-tick");
      const badges = gsap.utils.toArray<HTMLElement>(".gr-badge");
      const nodeRings = gsap.utils.toArray<HTMLElement>(".gr-node");

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: scope.current,
          start: "top top",
          end: "+=220%",
          pin: true,
          scrub: 0.6,
          anticipatePin: 1,
        },
      });

      // Initial card reveal
      tl.from(".gr-card", { opacity: 0, y: 20, duration: 0.3, ease: "power2.out" })
        .to(".gr-rail-fill", { scaleY: 1, duration: 2.4, ease: "none" }, 0.1);

      // Light up each check one by one on mouse scroll
      rows.forEach((row, i) => {
        const at = 0.2 + i * 0.28;
        tl.to(
          row,
          {
            opacity: 1,
            x: 0,
            duration: 0.25,
            ease: "power2.out",
          },
          at,
        )
          .to(
            nodeRings[i],
            {
              borderColor: "rgba(52,211,153,0.8)",
              backgroundColor: "rgba(52,211,153,0.12)",
              duration: 0.2,
            },
            at,
          )
          .to(badges[i], { opacity: 0, scale: 0.6, duration: 0.12 }, at)
          .to(ticks[i], { opacity: 1, scale: 1, duration: 0.2, ease: "back.out(2)" }, at + 0.08);
      });

      // Final verdict auto-approve reveal
      tl.fromTo(
        ".gr-verdict",
        { opacity: 0, y: 15, scale: 0.95 },
        { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "back.out(1.7)" },
        "+=0.1",
      );
    },
    still: () => {
      gsap.set(".gr-row", { opacity: 1, x: 0 });
      gsap.set(".gr-tick", { opacity: 1, scale: 1 });
      gsap.set(".gr-badge", { opacity: 0 });
      gsap.set(".gr-rail-fill", { scaleY: 1 });
      gsap.set(".gr-card", { opacity: 1, y: 0 });
      gsap.set(".gr-verdict", { opacity: 1, scale: 1 });
    },
  });

  return (
    <section ref={scope} id="guardrails" className="relative bg-[#131314] text-[#e5e2e3]">
      <div className="flex min-h-dvh items-center py-16">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 px-6 sm:px-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16 lg:items-start">
          {/* Left: what is being decided */}
          <div className="lg:sticky lg:top-24">
            <Eyebrow index="03">The guardrail engine</Eyebrow>
            <h2 className="font-serif mt-5 text-[clamp(2.2rem,4vw,3.3rem)] leading-[0.95] font-normal italic text-[#f5f3f0] tracking-[-0.02em]">
              Eight checks stand between
              <br />
              <span className="bg-gradient-to-r from-[#ffd0a8] via-[#ffb77b] to-[#b16d2e] bg-clip-text text-transparent">
                an agent and your money.
              </span>
            </h2>
            <p className="mt-5 max-w-md text-[14px] leading-relaxed text-[#c7b0a6]">
              Every purchase intent runs the same ordered gauntlet. Scroll to trace each check in real time.
              The first failure denies it, and the remaining checks are recorded as skipped so the trail shows exactly why it stopped.
            </p>

            <div className="gr-card mt-8 rounded-2xl border border-[#ffb77b]/25 bg-[#141416]/95 p-5 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.6)] backdrop-blur-md">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-[#b89a8e]">
                  <Lock size={12} className="text-[#ffb77b]" />
                  PURCHASE INTENT
                </span>
                <span className="rounded-md bg-[#34d399]/15 border border-[#34d399]/30 px-2.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-[#34d399] uppercase">
                  auto_approve
                </span>
              </div>
              <div className="mt-3.5 flex items-baseline justify-between gap-3 border-t border-white/[0.05] pt-3">
                <span className="text-[14px] font-medium text-[#f5f3f0]">
                  Aurora Wireless Optical Mouse
                </span>
                <span className="font-mono text-[16px] font-semibold text-[#ffb77b] tabular-nums">
                  ₹1,299.00
                </span>
              </div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-[#b89a8e]">
                Raised by the buyer agent under a mandate capped at ₹3,000 per purchase, inside a
                ₹10,000 budget, limited to electronics.
              </p>
            </div>
          </div>

          {/* Right: clean timeline without odd box containers */}
          <div className="relative pl-2">
            {/* Rail track & progressive fill */}
            <div className="absolute top-4 bottom-4 left-[14px] w-px bg-white/10" />
            <div className="gr-rail-fill absolute top-4 bottom-4 left-[14px] w-px origin-top scale-y-0 bg-gradient-to-b from-[#34d399] via-[#ffb77b] to-[#b16d2e]" />

            <ol className="space-y-4">
              {CHECKS.map((check) => (
                <li
                  key={check.id}
                  className="gr-row relative flex items-start gap-4 pl-0 opacity-35 translate-x-2 transition-all"
                >
                  {/* Step node */}
                  <span className="gr-node relative z-10 mt-0.5 grid size-[28px] shrink-0 place-items-center rounded-full border border-white/20 bg-[#141416] shadow-md transition-colors">
                    <span className="gr-badge font-mono text-[10px] font-bold text-[#b89a8e]">
                      {check.num}
                    </span>
                    <span className="gr-tick absolute grid place-items-center rounded-full text-[#34d399] opacity-0 scale-50">
                      <Check size={14} strokeWidth={3.5} />
                    </span>
                  </span>

                  {/* Clean text hierarchy without chunky box wrapper */}
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2.5">
                      <span className="font-mono text-[12.5px] font-bold text-[#ffb77b]">
                        {check.id}
                      </span>
                      <span className="text-[13.5px] font-medium text-[#f5f3f0]">
                        {check.name}
                      </span>
                    </div>
                    <p className="pt-1 text-[12px] leading-relaxed text-[#c7b0a6]">
                      {check.reason}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="gr-verdict mt-8 flex items-center gap-3 rounded-xl border border-[#34d399]/30 bg-[#34d399]/[0.08] px-4 py-3.5 shadow-lg opacity-0">
              <ShieldCheck size={18} className="shrink-0 text-[#34d399]" />
              <p className="text-[13px] leading-relaxed text-[#e5e2e3]">
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
export default GuardrailScene;
