"use client";

import { Boxes, KeyRound, Link2, ShieldCheck, Terminal, Wallet } from "lucide-react";

import { Glass } from "@/components/glass/glass";
import { GlassPill } from "@/components/glass/controls";
import { Honeycomb } from "@/components/landing/honeycomb";

/**
 * The bento.
 *
 * It replaces three equal cards that *described* the product with six unequal
 * ones that *show* it: the actual feed shape, the actual mandate scope, the
 * actual hash chain, the actual tool names. A bento is only worth the
 * asymmetry if the tiles differ in weight, so the two that carry the argument —
 * the guardrail comb and the catalog shape — get the space.
 */
export function Bento() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-6 lg:grid-cols-12">
      {/* The comb: the single thing this page is remembered by. */}
      <Glass depth={2} className="p-6 md:col-span-6 lg:col-span-7 lg:row-span-2">
        <TileHead
          icon={<ShieldCheck size={14} />}
          eyebrow="Eight guardrails, in order, every time"
          title="Bounded"
        />
        <p className="u-caption mt-2 mb-6 max-w-md">
          Identity and authorisation before bounds, bounds before fulfilment, and the human
          gate last — so it only fires on an otherwise-clean buy.
        </p>
        <Honeycomb />
      </Glass>

      {/* What an agent actually reads. */}
      <Glass depth={2} className="p-6 md:col-span-6 lg:col-span-5">
        <TileHead
          icon={<Boxes size={14} />}
          eyebrow="agentmandi.catalog.v1"
          title="Discoverable"
        />
        <p className="u-caption mt-2 mb-4">
          Typed, machine-readable, priced in integer paise. Nothing an agent needs is buried
          in prose or rendered into a picture of a price.
        </p>
        <pre className="u-numeric overflow-x-auto rounded-xl bg-[color-mix(in_srgb,var(--color-canvas)_66%,transparent)] p-4 text-[0.6875rem] leading-relaxed text-body">
{`{
  "id": "prod_elec_001",
  "title": "Aurora Wireless Optical Mouse",
  "category": "electronics",
  "price_paise": `}<span className="text-accent-text">129900</span>{`,
  "currency": "INR",
  "stock": 42
}`}
        </pre>
      </Glass>

      {/* Scope, not state — the idea that makes the mandate safe. */}
      <Glass depth={2} className="p-6 md:col-span-3 lg:col-span-5">
        <TileHead icon={<KeyRound size={14} />} eyebrow="JWT · HS256" title="Consent once" />
        <dl className="mt-4 space-y-2.5">
          {[
            ["per_txn_cap_paise", "₹3,000"],
            ["total_budget_paise", "₹10,000"],
            ["allowed_categories", "electronics, office"],
            ["expires_at", "in 24 hours"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="u-numeric text-[0.6875rem] text-caption">{k}</dt>
              <dd className="u-numeric text-[0.75rem] text-heading">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="u-caption mt-4 border-t border-white/[0.07] pt-3">
          The token carries <span className="text-heading">scope</span>, never{" "}
          <span className="text-heading">state</span>. Spend lives on the server, so editing
          your own &ldquo;remaining budget&rdquo; changes nothing.
        </p>
      </Glass>

      {/* The chain, drawn as a chain. */}
      <Glass depth={2} className="p-6 md:col-span-3 lg:col-span-4">
        <TileHead icon={<Link2 size={14} />} eyebrow="Append-only" title="Accountable" />
        <ol className="relative mt-4 space-y-3">
          <span
            className="absolute inset-y-1 left-[3px] w-px bg-[color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
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
                className="absolute left-0 size-[7px] rounded-full ring-[3px] ring-[var(--color-canvas)]"
                style={{ background: "var(--color-accent)" }}
                aria-hidden
              />
              <span className="u-numeric flex-1 text-[0.6875rem] text-body">{event}</span>
              <span className="u-numeric text-[0.625rem] text-caption">{hash}…</span>
            </li>
          ))}
        </ol>
        <p className="u-caption mt-4">Edit any row and every hash after it stops verifying.</p>
      </Glass>

      {/* Seven tools, named. */}
      <Glass depth={2} className="p-6 md:col-span-3 lg:col-span-4">
        <TileHead icon={<Terminal size={14} />} eyebrow="Model Context Protocol" title="Any agent can buy" />
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
              className="glass-surface glass-d0 u-numeric rounded-lg px-2.5 py-1.5 text-[0.6875rem] text-body"
            >
              {tool}
            </span>
          ))}
        </div>
      </Glass>

      {/* The claim that matters most, stated plainly. */}
      <Glass depth={2} className="flex flex-col justify-center p-6 md:col-span-3 lg:col-span-4">
        <TileHead icon={<Wallet size={14} />} eyebrow="Razorpay test mode" title="No real money" />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <GlassPill status="approve" label="Config refuses live keys">
            rzp_test_* only
          </GlassPill>
          <GlassPill status="gated" label="Human review threshold">
            gate at ₹5,000
          </GlassPill>
        </div>
        <p className="u-caption mt-4">
          The config refuses any key that is not a test key, so there is no path from this
          demo to a real charge.
        </p>
      </Glass>
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
        className="grid size-8 shrink-0 place-items-center rounded-xl text-accent-text"
        style={{ background: "color-mix(in srgb, var(--color-accent) 14%, transparent)" }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="u-micro block">{eyebrow}</span>
        <span className="u-title mt-0.5 block">{title}</span>
      </span>
    </div>
  );
}
