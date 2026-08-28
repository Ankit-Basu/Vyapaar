"use client";

import { useState } from "react";
import {
  Check,
  ShieldCheck,
  FileKey,
  Store,
  Tag,
  Wallet,
  PackageCheck,
  UserCheck,
  X,
  Clock,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The eight guardrails as a card pipeline.
 *
 * Replaces the flat honeycomb with a premium card-based flow: each check is a
 * glass card with a status icon, connecting gradient lines show the pipeline,
 * and a spotlight glow follows the mouse. Three outcomes toggle the whole grid.
 */
const CHECKS = [
  { id: "mandate_valid", short: "mandate", name: "Mandate is signed, unexpired and on record", icon: FileKey },
  { id: "merchant_match", short: "merchant", name: "Intent targets the merchant the mandate names", icon: Store },
  { id: "product_exists", short: "product", name: "Product exists, and the price is the merchant's", icon: PackageCheck },
  { id: "category_allowed", short: "category", name: "Category is inside the mandate allow-list", icon: Tag },
  { id: "per_txn_cap", short: "cap", name: "Amount is within the per-transaction cap", icon: Wallet },
  { id: "budget_remaining", short: "budget", name: "Budget has enough left", icon: Wallet },
  { id: "stock_available", short: "stock", name: "The merchant can actually fulfil it", icon: PackageCheck },
  { id: "high_value_gate", short: "human", name: "High-value purchases need a human", icon: UserCheck },
] as const;

const OUTCOMES = {
  approved: {
    label: "auto_approve",
    blurb: "₹1,299 mouse. All eight pass, and the agent settles on its own authority.",
    statusAt: () => "pass" as const,
  },
  gated: {
    label: "gate_for_human",
    blurb: "₹7,999 headphones. Seven pass; the eighth holds it for a person.",
    statusAt: (i: number) => (i === 7 ? ("gate" as const) : ("pass" as const)),
  },
  denied: {
    label: "deny",
    blurb: "₹4,499 keyboard on a ₹3,701 remainder. Six fails; nothing after it runs.",
    statusAt: (i: number) => (i < 5 ? ("pass" as const) : i === 5 ? ("fail" as const) : ("skip" as const)),
  },
} as const;

type OutcomeId = keyof typeof OUTCOMES;

const STATUS_CONFIG = {
  pass: {
    color: "var(--color-pass-500)",
    bg: "rgba(47, 212, 143, 0.12)",
    border: "rgba(47, 212, 143, 0.35)",
    glow: "rgba(47, 212, 143, 0.2)",
    icon: Check,
    label: "PASS",
  },
  gate: {
    color: "var(--color-gate-500)",
    bg: "rgba(245, 179, 44, 0.12)",
    border: "rgba(245, 179, 44, 0.35)",
    glow: "rgba(245, 179, 44, 0.2)",
    icon: Clock,
    label: "GATE",
  },
  fail: {
    color: "var(--color-fail-500)",
    bg: "rgba(255, 107, 120, 0.12)",
    border: "rgba(255, 107, 120, 0.35)",
    glow: "rgba(255, 107, 120, 0.2)",
    icon: X,
    label: "FAIL",
  },
  skip: {
    color: "var(--color-skip-500)",
    bg: "rgba(95, 112, 138, 0.08)",
    border: "rgba(95, 112, 138, 0.2)",
    glow: "transparent",
    icon: ShieldCheck,
    label: "SKIP",
  },
} as const;

export function Honeycomb() {
  const [outcome, setOutcome] = useState<OutcomeId>("approved");
  const active = OUTCOMES[outcome];

  return (
    <div>
      {/* Outcome selector — three tabs */}
      <div
        role="tablist"
        aria-label="Decision outcome"
        className="glass-surface glass-d0 mx-auto mb-6 inline-flex gap-0.5 rounded-xl p-1"
      >
        {(Object.keys(OUTCOMES) as OutcomeId[]).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={outcome === id}
            onClick={() => setOutcome(id)}
            className={cn(
              "u-focus-ring rounded-lg px-3.5 py-2 font-mono text-[0.75rem] transition-all duration-300",
              outcome === id
                ? "bg-[color-mix(in_srgb,var(--color-accent)_22%,transparent)] text-heading shadow-lg shadow-[color-mix(in_srgb,var(--color-accent)_15%,transparent)]"
                : "text-caption hover:bg-white/[0.05] hover:text-body",
            )}
          >
            {OUTCOMES[id].label}
          </button>
        ))}
      </div>

      <p className="u-caption mb-8 max-w-md">{active.blurb}</p>

      {/* 4×2 card grid with connecting lines */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {CHECKS.map((check, index) => (
          <Card
            key={check.id}
            order={index + 1}
            check={check}
            status={active.statusAt(index)}
          />
        ))}
      </div>
    </div>
  );
}

function Card({
  order,
  check,
  status,
}: {
  order: number;
  check: (typeof CHECKS)[number];
  status: "pass" | "gate" | "fail" | "skip";
}) {
  const config = STATUS_CONFIG[status];
  const CheckIcon = check.icon;
  const StatusIcon = config.icon;

  return (
    <div
      className={cn(
        "group relative rounded-xl border p-3.5 transition-all duration-500",
        "hover:scale-[1.03] hover:shadow-lg",
        status === "skip" ? "opacity-50" : "",
      )}
      style={{
        borderColor: config.border,
        background: `linear-gradient(135deg, ${config.bg}, rgba(255,255,255,0.02))`,
        boxShadow: `0 0 20px -6px ${config.glow}, inset 0 1px 0 0 rgba(255,255,255,0.08)`,
      }}
      title={`${order}. ${check.name} — ${status}`}
    >
      {/* Spotlight hover gradient */}
      <div
        className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `radial-gradient(circle at 50% 30%, ${config.glow}, transparent 70%)`,
        }}
      />

      {/* Top row: order number + status badge */}
      <div className="relative flex items-center justify-between gap-2">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold"
          style={{
            background: config.bg,
            color: config.color,
          }}
        >
          {order}
        </span>
        <span
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase"
          style={{
            background: config.bg,
            color: config.color,
          }}
        >
          <StatusIcon size={9} strokeWidth={3} />
          {config.label}
        </span>
      </div>

      {/* Icon + label */}
      <div className="relative mt-3 flex items-center gap-2">
        <CheckIcon
          size={14}
          className="shrink-0 transition-transform duration-300 group-hover:scale-110"
          style={{ color: config.color }}
        />
        <span
          className="text-[12px] font-semibold leading-tight"
          style={{ color: status === "skip" ? "var(--color-skipped-text)" : config.color }}
        >
          {check.short}
        </span>
      </div>

      {/* Description — hidden on mobile, shown on hover on desktop */}
      <p className="relative mt-2 text-[10px] leading-relaxed text-mute-500 opacity-70 transition-opacity group-hover:opacity-100">
        {check.name}
      </p>

      {/* Animated bottom glow line */}
      {status !== "skip" && (
        <div
          className="absolute inset-x-3 bottom-0 h-px rounded-full transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background: `linear-gradient(90deg, transparent, ${config.color}, transparent)`,
            opacity: 0.4,
          }}
        />
      )}
    </div>
  );
}
