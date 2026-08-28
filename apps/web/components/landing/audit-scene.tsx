"use client";

import { AlertTriangle, Link2, ShieldCheck } from "lucide-react";
import { useRef } from "react";

import { EASE, Eyebrow, gsap, useScene } from "@/components/landing/motion";

/** Five representative rows from a real run, in the order they were appended. */
const BLOCKS = [
  { seq: 1, label: "mandate.issued", hash: "2cc1119c", amount: "₹10,000 budget" },
  { seq: 2, label: "intent.created", hash: "8f4a0d31", amount: "₹1,299.00" },
  { seq: 3, label: "policy.decision", hash: "b1e77c92", amount: "auto_approve" },
  { seq: 4, label: "payment.initiated", hash: "5d2ac408", amount: "order_92m3zV" },
  { seq: 5, label: "intent.paid", hash: "067b1aff", amount: "₹1,299.00" },
] as const;

export function AuditScene() {
  const scope = useRef<HTMLElement>(null);

  useScene(scope, {
    motion: () => {
      gsap.set(".ac-block", { opacity: 0, y: 26, scale: 0.94 });
      gsap.set(".ac-link", { scaleX: 0 });
      gsap.set([".ac-verdict-ok", ".ac-verdict-bad"], { opacity: 0, y: 10 });
      gsap.set(".ac-tamper-badge", { opacity: 0, scale: 0.8 });

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: scope.current,
          start: "top top",
          end: "+=2400",
          pin: ".ac-stage",
          scrub: 0.7,
          anticipatePin: 1,
        },
      });

      // Phase 1 — the chain is written, block by block, each linked to the last.
      BLOCKS.forEach((_, index) => {
        const at = index * 0.8;
        timeline.to(
          `.ac-block-${index}`,
          { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: EASE },
          at,
        );
        if (index > 0) {
          timeline.to(`.ac-link-${index - 1}`, { scaleX: 1, duration: 0.4 }, at - 0.2);
        }
      });

      timeline.to(".ac-verdict-ok", { opacity: 1, y: 0, duration: 0.5 }, 4.2);

      // Phase 2 — someone edits a historical row behind the application's back.
      // The gap between the clean verdict and this is deliberate: the reader
      // needs a beat to register "valid: true" before it is taken away.
      const tamperAt = 6.4;
      timeline
        .to(".ac-verdict-ok", { opacity: 0, y: -8, duration: 0.3 }, tamperAt)
        .to(
          ".ac-block-2",
          {
            borderColor: "rgba(255,107,120,0.55)",
            backgroundColor: "rgba(255,107,120,0.09)",
            duration: 0.4,
          },
          tamperAt,
        )
        .to(".ac-tamper-badge", { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(2)" }, tamperAt + 0.15)
        .to(".ac-amount-2", { opacity: 0, duration: 0.2 }, tamperAt + 0.15)
        .set(".ac-amount-2", { textContent: "₹49,900.00", color: "#ff6b78" }, tamperAt + 0.35)
        .to(".ac-amount-2", { opacity: 1, duration: 0.25 }, tamperAt + 0.35)
        // Every link after the edited row is now broken: its stored hash no
        // longer matches what the content actually hashes to.
        .to(
          [".ac-link-2", ".ac-link-3"],
          { backgroundColor: "#ff6b78", duration: 0.35, stagger: 0.12 },
          tamperAt + 0.6,
        )
        .to(
          [".ac-block-3", ".ac-block-4"],
          { opacity: 0.45, duration: 0.35, stagger: 0.1 },
          tamperAt + 0.7,
        )
        .to(".ac-verdict-bad", { opacity: 1, y: 0, duration: 0.5 }, tamperAt + 1);
    },

    still: () => {
      gsap.set(".ac-block", { opacity: 1, y: 0, scale: 1 });
      gsap.set(".ac-link", { scaleX: 1 });
      gsap.set(".ac-verdict-ok", { opacity: 1, y: 0 });
      gsap.set(".ac-verdict-bad", { opacity: 0 });
      gsap.set(".ac-tamper-badge", { opacity: 0 });
    },
  });

  return (
    <section ref={scope} id="audit" className="relative">
      <div className="ac-stage flex min-h-dvh items-center py-20">
        <div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <div className="flex justify-center">
              <Eyebrow index="05">The audit trail</Eyebrow>
            </div>
            <h2 className="mt-5 text-[clamp(1.9rem,3.6vw,2.9rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
              Every decision is written down.
              <br />
              <span className="text-gradient">Editing one breaks all of them.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-[14px] leading-relaxed text-mute-400">
              Each row hashes its own contents together with the hash before it. The log is
              append-only in SQLite itself — <code className="font-mono text-[13px] text-brand-300">UPDATE</code>{" "}
              and <code className="font-mono text-[13px] text-brand-300">DELETE</code> are blocked
              by triggers, not by convention.
            </p>
          </div>

          {/* The chain */}
          <div className="mt-14 flex flex-col items-stretch gap-0 md:flex-row md:items-center">
            {BLOCKS.map((block, index) => (
              <div key={block.seq} className="contents">
                <div
                  className={`ac-block ac-block-${index} glass-flat relative flex-1 rounded-xl px-3.5 py-3`}
                >
                  {index === 2 && (
                    <span className="ac-tamper-badge absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-fail-500 px-2 py-0.5 text-[10px] font-bold tracking-wider text-ink-950 uppercase whitespace-nowrap">
                      edited
                    </span>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-mute-500">#{block.seq}</span>
                    <Link2 size={9} className="text-mute-500" />
                  </div>
                  <div className="mt-1 truncate text-[12px] font-medium text-mute-200">
                    {block.label}
                  </div>
                  <div
                    className={`ac-amount-${index} mt-0.5 truncate font-mono text-[11px] text-mute-400`}
                  >
                    {block.amount}
                  </div>
                  <div className="mt-2 truncate font-mono text-[10px] text-mute-500">
                    {block.hash}…
                  </div>
                </div>

                {index < BLOCKS.length - 1 && (
                  <div className="relative flex shrink-0 items-center justify-center py-1.5 md:px-1.5 md:py-0">
                    <span
                      className={`ac-link ac-link-${index} h-6 w-px origin-top bg-pass-500 md:h-px md:w-6 md:origin-left`}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Verdicts occupy the same slot, so one replaces the other in place. */}
          <div className="relative mt-10 flex h-16 items-start justify-center">
            <div className="ac-verdict-ok glass-flat absolute flex items-center gap-2.5 rounded-xl px-4 py-2.5">
              <ShieldCheck size={15} className="text-pass-500" />
              <span className="text-[13px] text-mute-300">
                <span className="font-mono text-pass-500">valid: true</span> — all 5 entries chain
                cleanly from genesis.
              </span>
            </div>
            <div className="ac-verdict-bad glass-flat absolute flex max-w-lg items-start gap-2.5 rounded-xl border-fail-500/40 px-4 py-2.5">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-fail-500" />
              <span className="text-[13px] leading-relaxed text-mute-300">
                <span className="font-mono text-fail-500">broken_at_seq: 3</span> — row 3&rsquo;s
                content no longer matches its stored hash, and every row after it is invalidated.
                The trail cannot be edited quietly.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
