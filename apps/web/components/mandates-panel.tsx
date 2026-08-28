"use client";

import { availablePaise, formatPaise, type MandateRecord } from "@agentmandi/shared-types";
import { Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getMandates } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CountUp, EmptyState, Mono, Panel, Ring, type Tone } from "@/components/ui";

export function MandatesPanel({
  refreshKey,
  className,
}: {
  refreshKey: number;
  className?: string;
}) {
  const [mandates, setMandates] = useState<MandateRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getMandates()
      .then((rows) => {
        setMandates(rows);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(load, [load, refreshKey]);

  const live = mandates.filter(
    (m) => !m.revoked_at && new Date(m.expires_at) > new Date(),
  ).length;

  return (
    <Panel
      title="Mandates"
      subtitle="Spend is tracked server-side. The token only carries scope."
      icon={<Wallet size={12} />}
      accent="pass"
      className={className}
      bodyClassName="p-3 space-y-2"
      actions={
        mandates.length > 0 ? (
          <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10.5px] text-mute-400">
            {live}/{mandates.length} live
          </span>
        ) : null
      }
    >
      {error ? (
        <EmptyState icon={<Wallet size={16} />}>{error}</EmptyState>
      ) : mandates.length === 0 ? (
        <EmptyState icon={<Wallet size={16} />}>
          No mandates issued yet. Granting one is the first thing the buyer agent needs.
        </EmptyState>
      ) : (
        mandates.map((mandate) => <BudgetMeter key={mandate.mandate_id} mandate={mandate} />)
      )}
    </Panel>
  );
}

function BudgetMeter({ mandate }: { mandate: MandateRecord }) {
  const total = mandate.total_budget_paise;
  const spentPct = total > 0 ? (mandate.spent_paise / total) * 100 : 0;
  const heldPct = total > 0 ? (mandate.reserved_paise / total) * 100 : 0;
  const available = availablePaise(mandate);
  const expired = new Date(mandate.expires_at) <= new Date();
  const dead = Boolean(mandate.revoked_at) || expired;

  // The ring reads as "how much of this mandate is still spendable", which is
  // the number an operator actually watches during a run.
  const remainingRatio = total > 0 ? available / total : 0;
  const tone: Tone = dead ? "skip" : remainingRatio < 0.15 ? "fail" : remainingRatio < 0.4 ? "gate" : "pass";

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3.5 shadow-sm backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/[0.04]",
        expired && "opacity-60",
      )}
    >
      <div className="flex items-center gap-3.5">
        <Ring value={remainingRatio} tone={tone} size={42} stroke={3.5}>
          <span className="font-mono text-[10px] font-semibold text-mute-200">
            {Math.round(remainingRatio * 100)}%
          </span>
        </Ring>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-semibold text-mute-100">
              {mandate.label ?? mandate.buyer_id}
            </span>
            <span className="shrink-0 font-mono text-[12.5px] font-semibold text-mute-200">
              <CountUp value={available} format={(n) => formatPaise(Math.round(n))} /> <span className="font-normal text-[11px] text-mute-400">left</span>
            </span>
          </div>

          {/* spent (solid) then held (dimmer) then remaining */}
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/10 shadow-inner">
            <div
              className="bar-fill bg-gradient-to-r from-pass-500 to-emerald-400 shadow-sm"
              style={{ width: `${Math.min(100, spentPct)}%` }}
            />
            <div
              className="bar-fill relative overflow-hidden bg-gate-500/80"
              style={{ width: `${Math.max(0, Math.min(100 - spentPct, heldPct))}%` }}
            >
              {/* A hold is money in flight */}
              <span className="animate-shimmer absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[11px] text-mute-400">
            <span>
              <span className="inline-block size-1.5 rounded-full bg-pass-500 align-middle shadow-sm shadow-pass-500/50" />{" "}
              spent <span className="font-mono font-medium text-mute-200">{formatPaise(mandate.spent_paise)}</span>
            </span>
            {mandate.reserved_paise > 0 && (
              <span>
                <span className="inline-block size-1.5 rounded-full bg-gate-500 align-middle shadow-sm shadow-gate-500/50" />{" "}
                held <span className="font-mono font-medium text-mute-200">{formatPaise(mandate.reserved_paise)}</span>
              </span>
            )}
            <span>
              of <span className="font-mono font-medium text-mute-200">{formatPaise(total)}</span>
            </span>
            <span>
              cap <span className="font-mono font-medium text-mute-200">{formatPaise(mandate.per_txn_cap_paise)}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-t border-white/[0.06] pt-2 text-[10.5px] text-mute-400">
        <Mono className="text-[10.5px] text-brand-300 font-medium">{mandate.mandate_id}</Mono>
        <span>·</span>
        <span className="text-mute-300">{mandate.allowed_categories.join(", ")}</span>
        {mandate.revoked_at ? (
          <span className="text-fail-500 font-medium">· revoked</span>
        ) : expired ? (
          <span className="text-fail-500 font-medium">· expired</span>
        ) : null}
      </div>
    </div>
  );
}
