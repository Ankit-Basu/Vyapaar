"use client";

import {
  ArrowRight,
  Ban,
  CalendarClock,
  CircleSlash,
  Layers,
  RefreshCw,
  ShieldCheck,
  Store,
  Tag,
  Terminal,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { cn } from "@/lib/utils";
import { EASE, Eyebrow, Reveal, Section, gsap, useScene } from "@/components/landing/motion";
import { GithubMark, Mark } from "@/components/landing/nav";

/* ------------------------------------------------------------------ stats --- */

const STATS = [
  { value: "8", label: "guardrails per purchase" },
  { value: "103", label: "tests passing" },
  { value: "7", label: "MCP tools exposed" },
  { value: "0", label: "rupees of real money" },
];

export function StatStrip() {
  const scope = useRef<HTMLElement>(null);

  useScene(scope, {
    motion: () => {
      // Count each number up as the strip enters. `snap` keeps them integers the
      // whole way rather than flickering through decimals.
      gsap.utils.toArray<HTMLElement>(".stat-value").forEach((el) => {
        const target = Number(el.dataset.value);
        gsap.from(el, {
          textContent: 0,
          duration: 1.4,
          ease: "power2.out",
          snap: { textContent: 1 },
          scrollTrigger: { trigger: scope.current, start: "top 85%", once: true },
        });
        el.dataset.settled = String(target);
      });
      gsap.from(".stat-item", {
        opacity: 0,
        y: 18,
        duration: 0.7,
        stagger: 0.08,
        ease: EASE,
        scrollTrigger: { trigger: scope.current, start: "top 85%", once: true },
      });
    },
    still: () => gsap.set(".stat-item", { opacity: 1, y: 0 }),
  });

  return (
    <section ref={scope} className="relative mx-auto max-w-7xl px-6 sm:px-8">
      <div className="glass grid grid-cols-2 gap-px overflow-hidden rounded-2xl md:grid-cols-4">
        {STATS.map((stat) => (
          <div key={stat.label} className="stat-item px-5 py-6 text-center">
            <div
              className="stat-value font-mono text-[clamp(1.6rem,3vw,2.2rem)] font-semibold tabular-nums text-gradient"
              data-value={stat.value}
            >
              {stat.value}
            </div>
            <div className="mt-1 text-[11.5px] leading-tight text-mute-500">{stat.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- problem --- */

export function Problem() {
  return (
    <Section id="problem">
      <Reveal>
        <Eyebrow index="01">The gap</Eyebrow>
      </Reveal>
      <Reveal stagger>
        <h2 className="mt-5 max-w-3xl text-[clamp(1.9rem,3.6vw,2.9rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
          Conversational checkout already exists.
          <span className="block text-mute-500">It just lives inside the merchant&rsquo;s app.</span>
        </h2>
        <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-mute-400">
          That solves shopping for the people who already opened your app. It does nothing for the
          agent that has never heard of you — the one browsing on someone&rsquo;s behalf, comparing
          across merchants, ready to buy if only it could.
        </p>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-mute-400">
          Opening that door is easy. Opening it{" "}
          <strong className="font-medium text-mute-100">safely</strong> is the whole problem: the
          buyer is software, it does not read your terms, and nobody is watching the screen when it
          decides to spend.
        </p>
      </Reveal>

      <Reveal stagger className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: Store,
            title: "Discoverable",
            body: "A machine-readable feed and semantic search, with typed prices in integer paise. Nothing an agent needs is buried in prose.",
          },
          {
            icon: ShieldCheck,
            title: "Bounded",
            body: "A signed mandate carries a per-purchase cap, a total budget, a category allow-list and an expiry. Enforced server-side, every time.",
          },
          {
            icon: Layers,
            title: "Accountable",
            body: "Every check, decision and rupee lands in an append-only hash chain you can verify with one request.",
          },
        ].map((card) => (
          <div key={card.title} className="glass rounded-2xl p-5">
            <card.icon size={17} className="text-brand-400" />
            <h3 className="mt-3.5 text-[14px] font-semibold">{card.title}</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-mute-500">{card.body}</p>
          </div>
        ))}
      </Reveal>
    </Section>
  );
}

/* ---------------------------------------------------------------- mandate --- */

const SCOPE_ROWS = [
  { icon: Wallet, key: "per_txn_cap_paise", value: "₹3,000", note: "any single purchase" },
  { icon: Wallet, key: "total_budget_paise", value: "₹10,000", note: "across the whole mandate" },
  { icon: Tag, key: "allowed_categories", value: "electronics, office", note: "nothing else" },
  { icon: CalendarClock, key: "expires_at", value: "in 24 hours", note: "then it is dead" },
];

export function Mandate() {
  const scope = useRef<HTMLDivElement>(null);

  useScene(scope, {
    motion: () => {
      gsap.from(".scope-row", {
        opacity: 0,
        x: -18,
        duration: 0.6,
        stagger: 0.1,
        ease: EASE,
        scrollTrigger: { trigger: ".scope-card", start: "top 78%", once: true },
      });
      gsap.from(".scope-card", {
        opacity: 0,
        y: 30,
        rotateX: 10,
        duration: 0.9,
        ease: EASE,
        scrollTrigger: { trigger: ".scope-card", start: "top 82%", once: true },
      });
    },
    still: () => gsap.set([".scope-card", ".scope-row"], { opacity: 1, x: 0, y: 0, rotateX: 0 }),
  });

  return (
    <Section id="mandate" wide>
      <div ref={scope} className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <Reveal>
            <Eyebrow index="02">The mandate</Eyebrow>
          </Reveal>
          <Reveal stagger>
            <h2 className="mt-5 text-[clamp(1.9rem,3.6vw,2.9rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
              Consent once.
              <br />
              <span className="text-gradient">Spend within it, forever after.</span>
            </h2>
            <p className="mt-6 text-[15px] leading-relaxed text-mute-400">
              A human signs one authorisation, and the agent transacts under it without a PIN or an
              OTP each time — the pattern NPCI&rsquo;s Unified Agent Protocol describes, and AP2
              encodes. UAP is not live yet, so this is our own signed mandate rather than a
              dependency on an unreleased spec.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-mute-400">
              The subtlety that makes it safe: the token carries{" "}
              <strong className="font-medium text-mute-100">scope</strong>, never{" "}
              <strong className="font-medium text-mute-100">state</strong>. How much has been spent
              lives on the server. A holder who edits their own &ldquo;remaining budget&rdquo;
              changes nothing at all.
            </p>
          </Reveal>
        </div>

        <div style={{ perspective: 1000 }}>
          <div className="scope-card glass-strong rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10.5px] text-mute-500">
                JWT · HS256 · agentmandi.mandate.v1
              </span>
              <span className="rounded-md bg-brand-glow px-2 py-0.5 text-[10px] font-bold tracking-wider text-brand-400 uppercase">
                signed
              </span>
            </div>

            <div className="rule-fade my-4" />

            <ul className="space-y-3">
              {SCOPE_ROWS.map((row) => (
                <li key={row.key} className="scope-row flex items-center gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.05]">
                    <row.icon size={13} className="text-brand-400" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[11px] text-mute-500">{row.key}</span>
                    <span className="block text-[13px] font-medium text-mute-100">
                      {row.value}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-[10.5px] text-mute-500 sm:block">
                    {row.note}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-5 rounded-lg bg-fail-bg px-3 py-2.5">
              <p className="flex items-start gap-2 text-[11px] leading-relaxed text-fail-500">
                <Ban size={12} className="mt-0.5 shrink-0" />
                Edit the cap and re-sign it with the wrong key, and verification fails before a
                single bound is even consulted.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- failure --- */

export function Failure() {
  const scope = useRef<HTMLDivElement>(null);

  useScene(scope, {
    motion: () => {
      gsap.from(".fail-card", {
        opacity: 0,
        y: 26,
        duration: 0.8,
        stagger: 0.18,
        ease: EASE,
        scrollTrigger: { trigger: ".fail-grid", start: "top 80%", once: true },
      });
      gsap.from(".fail-arrow", {
        opacity: 0,
        scale: 0.6,
        duration: 0.5,
        ease: "back.out(2)",
        scrollTrigger: { trigger: ".fail-grid", start: "top 72%", once: true },
      });
    },
    still: () => gsap.set([".fail-card", ".fail-arrow"], { opacity: 1, y: 0, scale: 1 }),
  });

  return (
    <Section id="failure" wide>
      <div ref={scope}>
        <Reveal>
          <Eyebrow index="04">When it goes wrong</Eyebrow>
        </Reveal>
        <Reveal stagger>
          <h2 className="mt-5 max-w-3xl text-[clamp(1.9rem,3.6vw,2.9rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
            A refusal should teach the agent something.
          </h2>
          <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-mute-400">
            Denials name the exact arithmetic, so the agent can act on them. It reads{" "}
            <em className="text-mute-200 not-italic">which</em> check failed and re-plans against
            that specific bound — then retries once and stops, rather than hammering the merchant.
          </p>
        </Reveal>

        <div className="fail-grid mt-12 grid items-center gap-4 lg:grid-cols-[1fr_auto_1fr]">
          <div className="fail-card glass rounded-2xl border-fail-500/30 p-5">
            <div className="flex items-center gap-2">
              <CircleSlash size={14} className="text-fail-500" />
              <span className="text-[10px] font-bold tracking-wider text-fail-500 uppercase">
                denied · budget_remaining
              </span>
            </div>
            <div className="mt-3.5 flex items-baseline justify-between gap-3">
              <span className="text-[13.5px] font-medium text-mute-100">
                Nimbus TKL Mechanical Keyboard
              </span>
              <span className="font-mono text-[16px] font-semibold tabular-nums text-mute-300">
                ₹4,499
              </span>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-mute-400">
              Clears the ₹4,500 per-transaction cap with ₹1 to spare, but only ₹3,701 of the budget
              remains after the mouse.{" "}
              <strong className="font-medium text-fail-500">Short by ₹798.00.</strong>
            </p>
            <p className="mt-2.5 text-[11px] leading-relaxed text-mute-500">
              Checks 1–5 passed. Check 6 failed. Checks 7–8 recorded as skipped.
            </p>
          </div>

          <div className="fail-arrow flex items-center justify-center py-2 lg:px-2">
            <span className="glass grid size-9 place-items-center rounded-full">
              <RefreshCw size={14} className="text-brand-400" />
            </span>
          </div>

          <div className="fail-card glass rounded-2xl border-pass-500/30 p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-pass-500" />
              <span className="text-[10px] font-bold tracking-wider text-pass-500 uppercase">
                re-planned · paid
              </span>
            </div>
            <div className="mt-3.5 flex items-baseline justify-between gap-3">
              <span className="text-[13.5px] font-medium text-mute-100">
                Nimbus Wireless Keyboard
              </span>
              <span className="font-mono text-[16px] font-semibold tabular-nums text-mute-300">
                ₹2,499
              </span>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-mute-400">
              &ldquo;Re-searching under the ₹3,701.00 the mandate actually has left.&rdquo; The
              agent came back with a cheaper keyboard instead of retrying the same one.
            </p>
            <p className="mt-2.5 text-[11px] leading-relaxed text-mute-500">
              Settled. ₹3,798 spent of ₹5,000, ₹1,202 still available.
            </p>
          </div>
        </div>

        <Reveal stagger className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            {
              t: "Card declined",
              b: "The intent goes FAILED and the budget hold is released. A charge that did not succeed never consumes the buyer's budget.",
            },
            {
              t: "Out of stock mid-flow",
              b: "The last unit sells to someone else between the agent's search and its intent. It re-plans inside the same run.",
            },
            {
              t: "Forged mandate",
              b: "A token edited to raise its own cap fails signature verification before any bound is consulted.",
            },
          ].map((item) => (
            <div key={item.t} className="rounded-xl bg-white/[0.025] px-4 py-3.5">
              <h3 className="text-[12.5px] font-semibold text-mute-200">{item.t}</h3>
              <p className="mt-1 text-[11.5px] leading-relaxed text-mute-500">{item.b}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- mcp --- */

const TERMINAL_LINES = [
  { kind: "prompt", text: "Buy me a wireless mouse under ₹1,500." },
  { kind: "tool", text: "search_catalog(query=\"wireless mouse\", max_price_paise=150000)" },
  { kind: "out", text: "→ prod_elec_001 · Aurora Wireless Optical Mouse · ₹1,299.00 · 42 in stock" },
  { kind: "tool", text: "create_purchase_intent(mandate_token=…, product_id=\"prod_elec_001\")" },
  { kind: "out", text: "→ decision: auto_approve · 8/8 checks passed" },
  { kind: "tool", text: "confirm_purchase(intent_id=\"int_9f3a…\")" },
  { kind: "ok", text: "→ PAID · ₹1,299.00 · ₹8,701.00 left on the mandate" },
] as const;

export function Mcp() {
  const scope = useRef<HTMLDivElement>(null);

  useScene(scope, {
    motion: () => {
      gsap.from(".term-line", {
        opacity: 0,
        x: -14,
        duration: 0.45,
        stagger: 0.13,
        ease: EASE,
        scrollTrigger: { trigger: ".term", start: "top 76%", once: true },
      });
      gsap.from(".term", {
        opacity: 0,
        y: 28,
        duration: 0.9,
        ease: EASE,
        scrollTrigger: { trigger: ".term", start: "top 82%", once: true },
      });
    },
    still: () => gsap.set([".term", ".term-line"], { opacity: 1, x: 0, y: 0 }),
  });

  return (
    <Section id="mcp" wide>
      <div ref={scope} className="grid grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16">
        <div>
          <Reveal>
            <Eyebrow index="06">Any agent can buy</Eyebrow>
          </Reveal>
          <Reveal stagger>
            <h2 className="mt-5 text-[clamp(1.9rem,3.6vw,2.9rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
              Point an MCP client at it
              <br />
              <span className="text-gradient">and it can shop.</span>
            </h2>
            <p className="mt-6 text-[15px] leading-relaxed text-mute-400">
              Seven tools over the merchant&rsquo;s public HTTP API — deliberately an adapter, not
              an in-process shortcut, because that is how a merchant would actually ship it. Claude
              Desktop, or anything else that speaks MCP, can discover, price and buy.
            </p>
            <div className="mt-6 flex flex-wrap gap-1.5">
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
                  className="rounded-md bg-white/[0.04] px-2 py-1 font-mono text-[10.5px] text-mute-400"
                >
                  {tool}
                </span>
              ))}
            </div>
          </Reveal>
        </div>

        <div className="term glass-strong overflow-hidden rounded-2xl">
          <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-2.5">
            <Terminal size={12} className="text-mute-500" />
            <span className="font-mono text-[10.5px] text-mute-500">
              claude desktop · agentmandi
            </span>
            <span className="ml-auto flex gap-1.5">
              <span className="size-2 rounded-full bg-white/10" />
              <span className="size-2 rounded-full bg-white/10" />
              <span className="size-2 rounded-full bg-pass-500/60" />
            </span>
          </div>
          <div className="space-y-2 p-4">
            {TERMINAL_LINES.map((line, i) => (
              <p
                key={i}
                className={cn(
                  "term-line font-mono text-[11.5px] leading-relaxed break-words",
                  line.kind === "prompt" && "text-mute-100",
                  line.kind === "tool" && "text-brand-300",
                  line.kind === "out" && "text-mute-500",
                  line.kind === "ok" && "text-pass-500",
                )}
              >
                {line.kind === "prompt" && <span className="mr-1.5 text-mute-500">›</span>}
                {line.text}
              </p>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- cta --- */

export function Cta() {
  return (
    <Section className="pb-16 text-center">
      <Reveal stagger>
        <h2 className="mx-auto max-w-2xl text-[clamp(2rem,4.2vw,3.2rem)] leading-[1.03] font-semibold tracking-[-0.035em]">
          Watch it happen <span className="text-gradient">live.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-mute-400">
          The control room streams every guardrail decision, budget movement and audit row as it
          happens. Seven scripted scenarios — including four ways this goes wrong — are one click
          each.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="group inline-flex h-12 items-center gap-2 rounded-xl bg-mute-100 px-6 text-[14px] font-semibold text-ink-950 transition-transform hover:scale-[1.03]"
          >
            Open the control room
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="https://github.com/Ankit-Basu/AgentMandi"
            target="_blank"
            rel="noreferrer"
            className="glass inline-flex h-12 items-center gap-2 rounded-xl px-6 text-[14px] font-medium text-mute-200 transition-colors hover:text-white"
          >
            <GithubMark className="size-4" />
            Read the source
          </a>
        </div>
      </Reveal>
    </Section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row sm:px-8">
        <div className="flex items-center gap-2.5">
          <Mark className="size-6 text-[11px]" />
          <span className="text-[12.5px] text-mute-400">
            AgentMandi — an agent commerce layer
          </span>
        </div>
        <p className="text-center text-[11.5px] text-mute-500 sm:text-right">
          Razorpay <strong className="font-medium text-mute-400">test mode only</strong>. No real
          money moves, and the config refuses any key that is not <code className="font-mono">rzp_test_*</code>.
        </p>
      </div>
    </footer>
  );
}
