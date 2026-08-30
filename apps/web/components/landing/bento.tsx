"use client";

import { useRef } from "react";
import { Boxes, KeyRound, Link2, ShieldCheck, Terminal, Wallet } from "lucide-react";
import { Glass } from "@/components/glass/glass";
import { GlassPill } from "@/components/glass/controls";
import { Honeycomb } from "@/components/landing/honeycomb";
import { EASE, gsap, useScene } from "@/components/landing/motion";

export function Bento() {
  const scope = useRef<HTMLDivElement>(null);

  useScene(scope, {
    motion: () => {
      gsap.from(".bento-tile", {
        opacity: 0,
        y: 35,
        duration: 0.8,
        stagger: 0.12,
        ease: EASE,
        scrollTrigger: { trigger: scope.current, start: "top 80%", once: true },
      });
    },
    still: () => gsap.set(".bento-tile", { opacity: 1, y: 0 }),
  });

  return (
    <div ref={scope} className="grid grid-cols-1 gap-4 md:grid-cols-6 lg:grid-cols-12">
      {/* The comb: the single thing this page is remembered by. */}
      <div className="bento-tile md:col-span-6 lg:col-span-7 lg:row-span-2">
        <Glass depth={2} className="h-full p-6 border border-[#ffb77b]/15 bg-[#141416]/90 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.6)] rounded-2xl">
          <TileHead
            icon={<ShieldCheck size={14} />}
            eyebrow="Eight guardrails, in order, every time"
            title="Deterministic Bounds"
          />
          <p className="mt-2 mb-6 max-w-md text-[13px] text-[#c7b0a6] leading-relaxed">
            Identity and authorisation before bounds, bounds before fulfilment, and the human
            gate last — so it only fires on an otherwise-clean buy.
          </p>
          <Honeycomb />
        </Glass>
      </div>

      {/* What an agent actually reads. */}
      <div className="bento-tile md:col-span-6 lg:col-span-5">
        <Glass depth={2} className="h-full p-6 border border-[#ffb77b]/15 bg-[#141416]/90 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.6)] rounded-2xl">
          <TileHead
            icon={<Boxes size={14} />}
            eyebrow="vyapaar.catalog.v1"
            title="Machine-Readable"
          />
          <p className="mt-2 mb-4 text-[13px] text-[#c7b0a6] leading-relaxed">
            Typed, machine-readable, priced in integer paise. Nothing an agent needs is buried
            in prose or rendered into a picture of a price.
          </p>
          <pre className="overflow-x-auto rounded-xl bg-[#0e0e0f]/90 border border-[#444748]/25 p-4 font-mono text-[11px] leading-relaxed text-[#e5e2e3]">
{`{
  "id": "prod_elec_001",
  "title": "Aurora Wireless Optical Mouse",
  "category": "electronics",
  "price_paise": `}<span className="text-[#ffb77b] font-semibold">129900</span>{`,
  "currency": "INR",
  "stock": 42
}`}
          </pre>
        </Glass>
      </div>

      {/* Scope, not state — the idea that makes the mandate safe. */}
      <div className="bento-tile md:col-span-3 lg:col-span-5">
        <Glass depth={2} className="h-full p-6 border border-[#ffb77b]/15 bg-[#141416]/90 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.6)] rounded-2xl">
          <TileHead icon={<KeyRound size={14} />} eyebrow="JWT · HS256" title="Consent Once" />
          <dl className="mt-4 space-y-2.5">
            {[
              ["per_txn_cap_paise", "₹3,000"],
              ["total_budget_paise", "₹10,000"],
              ["allowed_categories", "electronics, office"],
              ["expires_at", "in 24 hours"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] pb-1.5">
                <dt className="font-mono text-[11px] text-[#b89a8e]">{k}</dt>
                <dd className="font-mono text-[12px] font-semibold text-[#ffb77b]">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 border-t border-white/[0.07] pt-3 text-[12px] text-[#c7b0a6] leading-relaxed">
            The token carries <span className="text-[#f5f3f0] font-semibold">scope</span>, never{" "}
            <span className="text-[#f5f3f0] font-semibold">state</span>. Spend lives on the server, so editing
            your own &ldquo;remaining budget&rdquo; changes nothing.
          </p>
        </Glass>
      </div>

      {/* The chain, drawn as a chain. */}
      <div className="bento-tile md:col-span-3 lg:col-span-4">
        <Glass depth={2} className="h-full p-6 border border-[#ffb77b]/15 bg-[#141416]/90 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.6)] rounded-2xl">
          <TileHead icon={<Link2 size={14} />} eyebrow="Append-only" title="Auditability" />
          <ol className="relative mt-4 space-y-3">
            <span
              className="absolute inset-y-1 left-[3px] w-px bg-[#ffb77b]/40"
              aria-hidden
            />
            {[
              ["mandate.issued", "9f3ac21b"],
              ["intent.created", "0b12de99"],
              ["policy.decision", "5c8e1a2b"],
              ["payment.initiated", "e41bb093"],
              ["intent.paid", "7cc2a410"],
            ].map(([event, hash]) => (
              <li key={event} className="relative flex items-center gap-3 pl-4">
                <span
                  className="absolute left-0 size-[7px] rounded-full ring-[3px] ring-[#131314]"
                  style={{ background: "#ffb77b" }}
                  aria-hidden
                />
                <span className="font-mono flex-1 text-[11px] text-[#e5e2e3]">{event}</span>
                <span className="font-mono text-[10px] text-[#ffb77b]">{hash}…</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[12px] text-[#b89a8e]">Edit any row and every hash after it stops verifying.</p>
        </Glass>
      </div>

      {/* Seven tools, named. */}
      <div className="bento-tile md:col-span-3 lg:col-span-4">
        <Glass depth={2} className="h-full p-6 border border-[#ffb77b]/15 bg-[#141416]/90 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.6)] rounded-2xl">
          <TileHead icon={<Terminal size={14} />} eyebrow="Model Context Protocol" title="Any Agent Can Shop" />
          <div className="mt-4 flex flex-wrap gap-1.5">
            {[
              "search_catalog",
              "get_product",
              "create_purchase_intent",
              "confirm_purchase",
              "check_mandate",
              "check_intent",
              "get_merchant_info",
            ].map((tool) => (
              <span
                key={tool}
                className="rounded-lg border border-[#ffb77b]/20 bg-[#ffb77b]/[0.06] px-2.5 py-1 font-mono text-[11px] text-[#ffb77b] transition hover:bg-[#ffb77b]/20"
              >
                {tool}
              </span>
            ))}
          </div>
        </Glass>
      </div>

      {/* The claim that matters most, stated plainly. */}
      <div className="bento-tile md:col-span-3 lg:col-span-4">
        <Glass depth={2} className="flex flex-col justify-center h-full p-6 border border-[#ffb77b]/15 bg-[#141416]/90 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.6)] rounded-2xl">
          <TileHead icon={<Wallet size={14} />} eyebrow="Razorpay testnet" title="Zero Financial Risk" />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <GlassPill status="approve" label="Config refuses live keys">
              rzp_test_* only
            </GlassPill>
            <GlassPill status="gated" label="Human review threshold">
              gate at ₹5,000
            </GlassPill>
          </div>
          <p className="mt-4 text-[12px] text-[#c7b0a6] leading-relaxed">
            The server strictly rejects any non-test API keys, guaranteeing zero real-money exposure during integration.
          </p>
        </Glass>
      </div>
    </div>
  );
}

function TileHead({
  icon,
  eyebrow,
  title,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="grid size-8 shrink-0 place-items-center rounded-xl text-[#ffb77b] bg-[#ffb77b]/15 border border-[#ffb77b]/30 shadow-[0_0_12px_rgba(255,183,123,0.2)]"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-[10px] tracking-[0.2em] text-[#ffb77b] uppercase">{eyebrow}</span>
        <span className="mt-0.5 block font-serif text-[17px] font-normal italic text-[#f5f3f0]">{title}</span>
      </span>
    </div>
  );
}
