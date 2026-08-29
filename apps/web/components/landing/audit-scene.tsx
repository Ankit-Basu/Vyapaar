"use client";

import { useState } from "react";
import { Check, Link2, ShieldAlert, ShieldCheck, RefreshCw } from "lucide-react";
import { useRef } from "react";
import { Eyebrow, gsap, useScene } from "@/components/landing/motion";

const BLOCKS = [
  { seq: 1, label: "mandate.issued", amount: "₹10,000 cap", hash: "9f3ac21b" },
  { seq: 2, label: "intent.created", amount: "₹1,299.00", hash: "0b12de99" },
  { seq: 3, label: "policy.decision", amount: "auto_approve", hash: "5c8e1a2b" },
  { seq: 4, label: "payment.initiated", amount: "order_9f3a", hash: "e41bb093" },
  { seq: 5, label: "intent.paid", amount: "settled", hash: "7cc2a410" },
] as const;

export function AuditScene() {
  const scope = useRef<HTMLElement>(null);
  const [tampered, setTampered] = useState(false);

  useScene(scope, {
    motion: () => {
      const blocks = gsap.utils.toArray<HTMLElement>(".ac-block-item");
      const links = gsap.utils.toArray<HTMLElement>(".ac-link-bar");

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: scope.current,
          start: "top top",
          end: "+=180%",
          pin: true,
          scrub: 0.6,
          anticipatePin: 1,
        },
      });

      // Sequential block-by-block hash linking on mouse scroll
      blocks.forEach((block, i) => {
        const at = i * 0.35;
        tl.to(
          block,
          {
            opacity: 1,
            scale: 1,
            borderColor: "rgba(255,183,123,0.3)",
            backgroundColor: "rgba(20,20,22,0.95)",
            duration: 0.3,
            ease: "power2.out",
          },
          at,
        );

        if (i < links.length) {
          tl.to(
            links[i],
            {
              scaleX: 1,
              duration: 0.25,
              ease: "power1.inOut",
            },
            at + 0.15,
          );
        }
      });

      // Verdict reveal at end of scroll
      tl.fromTo(
        ".ac-verdict-banner",
        { opacity: 0, y: 15, scale: 0.96 },
        { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "back.out(1.7)" },
        "+=0.1",
      );
    },
    still: () => {
      gsap.set(".ac-block-item", { opacity: 1, scale: 1 });
      gsap.set(".ac-link-bar", { scaleX: 1 });
      gsap.set(".ac-verdict-banner", { opacity: 1, y: 0, scale: 1 });
    },
  });

  return (
    <section ref={scope} id="audit" className="relative bg-[#131314] text-[#e5e2e3]">
      <div className="flex min-h-dvh items-center py-20">
        <div className="mx-auto w-full max-w-6xl px-6 sm:px-10">
          <div className="mx-auto max-w-2xl text-center">
            <div className="flex justify-center">
              <Eyebrow index="05">The audit trail</Eyebrow>
            </div>
            <h2 className="font-serif mt-5 text-[clamp(2.2rem,4vw,3.3rem)] leading-[0.95] font-normal italic text-[#f5f3f0] tracking-[-0.02em]">
              Every decision is written down.
              <br />
              <span className="bg-gradient-to-r from-[#ffd0a8] via-[#ffb77b] to-[#b16d2e] bg-clip-text text-transparent">
                Editing one breaks all of them.
              </span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-[14px] leading-relaxed text-[#c7b0a6]">
              Each row hashes its own contents together with the hash before it. Scroll to witness the cryptographic chain construct sequentially.
              The log is append-only in SQLite itself — <code className="font-mono text-[13px] text-[#ffb77b]">UPDATE</code>{" "}
              and <code className="font-mono text-[13px] text-[#ffb77b]">DELETE</code> are blocked by triggers.
            </p>

            {/* Interactive Simulation Toggle */}
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => setTampered((prev) => !prev)}
                className="inline-flex items-center gap-2 rounded-xl border border-[#ffb77b]/40 bg-[#ffb77b]/[0.1] px-5 py-2.5 font-mono text-[11px] font-bold text-[#ffb77b] uppercase tracking-wider transition hover:bg-[#ffb77b]/20 hover:border-[#ffb77b] shadow-lg cursor-pointer"
              >
                <RefreshCw size={13} className={tampered ? "animate-spin" : ""} />
                {tampered ? "RESTORE ORIGINAL VALID CHAIN" : "SIMULATE DATABASE TAMPER ON BLOCK #3"}
              </button>
            </div>
          </div>

          {/* The chain with scroll-scrubbed reveal */}
          <div className="mt-14 flex flex-col items-stretch gap-2 md:flex-row md:items-center">
            {BLOCKS.map((block, index) => {
              const isTamperedBlock = tampered && index === 2;
              const isBrokenDownstream = tampered && index > 2;

              return (
                <div key={block.seq} className="contents">
                  <div
                    className={`ac-block-item relative flex-1 rounded-2xl border p-4.5 backdrop-blur-md transition-all duration-500 shadow-xl opacity-35 scale-95 border-white/[0.08] bg-[#141416]/50 ${
                      isTamperedBlock
                        ? "!border-[#fb5b6b] !bg-[#2a1417]/95 !opacity-100 shadow-[0_0_30px_rgba(251,91,107,0.35)]"
                        : isBrokenDownstream
                          ? "!border-[#fb5b6b]/40 !bg-[#1c1416]/90 !opacity-100"
                          : ""
                    }`}
                  >
                    {/* Status Badge */}
                    {isTamperedBlock && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#fb5b6b] px-3 py-0.5 font-mono text-[10px] font-bold tracking-wider text-[#0e0e0f] uppercase whitespace-nowrap shadow-lg animate-pulse">
                        TAMPERED
                      </span>
                    )}
                    {isBrokenDownstream && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-[#fb5b6b]/60 bg-[#fb5b6b]/20 px-2.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-[#fb5b6b] uppercase whitespace-nowrap shadow-md">
                        INVALIDATED
                      </span>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-mono text-[11px] font-bold ${
                          isTamperedBlock || isBrokenDownstream ? "text-[#fb5b6b]" : "text-[#ffb77b]"
                        }`}
                      >
                        #{block.seq}
                      </span>
                      <Link2
                        size={12}
                        className={isTamperedBlock || isBrokenDownstream ? "text-[#fb5b6b]" : "text-[#b89a8e]"}
                      />
                    </div>

                    <div className="mt-1.5 truncate font-mono text-[12px] font-medium text-[#f5f3f0]">
                      {block.label}
                    </div>

                    <div
                      className={`mt-0.5 truncate font-mono text-[11px] font-semibold ${
                        isTamperedBlock
                          ? "text-[#fb5b6b]"
                          : isBrokenDownstream
                            ? "text-[#f5f3f0]/80"
                            : "text-[#c7b0a6]"
                      }`}
                    >
                      {isTamperedBlock ? "₹49,900.00 (FORGED)" : block.amount}
                    </div>

                    <div className="mt-3 truncate border-t border-white/[0.06] pt-2 font-mono text-[10px]">
                      <span className="text-mute-500">prev: </span>
                      {isTamperedBlock ? (
                        <span className="text-[#fb5b6b] font-bold">5c8e1a2b (MODIFIED)</span>
                      ) : isBrokenDownstream ? (
                        <span className="text-[#fb5b6b] font-semibold flex items-center gap-1 inline-flex">
                          <span className="line-through opacity-70">{block.hash}</span>
                          <span className="text-[9px] bg-[#fb5b6b]/20 px-1 rounded">MISMATCH</span>
                        </span>
                      ) : (
                        <span className="text-[#ffb77b]">{block.hash}</span>
                      )}
                    </div>
                  </div>

                  {index < BLOCKS.length - 1 && (
                    <div className="relative my-2 flex h-5 w-full items-center justify-center md:my-0 md:h-auto md:w-6 md:shrink-0">
                      <div
                        className={`ac-link-bar h-0.5 w-full origin-left scale-x-0 transition-colors duration-500 ${
                          tampered && index >= 2
                            ? "!bg-[#fb5b6b] !scale-x-100 shadow-[0_0_8px_#fb5b6b]"
                            : "bg-[#ffb77b]/60"
                        }`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Dynamic verdict */}
          <div className="ac-verdict-banner mt-10 mx-auto max-w-xl opacity-0">
            {!tampered ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-[#34d399]/30 bg-[#34d399]/[0.08] px-4 py-3 text-center transition-all">
                <ShieldCheck size={16} className="text-[#34d399]" />
                <span className="font-mono text-[12px] font-semibold text-[#34d399]">
                  CHAIN INTACT · 5/5 SHA-256 HASHES CRYPTOGRAPHICALLY VERIFIED
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-[#fb5b6b]/50 bg-[#fb5b6b]/[0.15] px-5 py-3.5 text-center transition-all shadow-[0_0_20px_rgba(251,91,107,0.25)]">
                <ShieldAlert size={18} className="text-[#fb5b6b] shrink-0 animate-bounce" />
                <span className="font-mono text-[12px] font-bold text-[#fb5b6b]">
                  INTEGRITY FAULT · HASH CHAIN BROKEN AT BLOCK #3 (DOWNSTREAM INVALIDATED)
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
export default AuditScene;
