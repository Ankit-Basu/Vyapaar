"use client";

import { availablePaise, formatPaise, type MandateRecord } from "@agentmandi/shared-types";
import { useCallback, useEffect, useState } from "react";

import { getMandates } from "@/lib/api";
import { EmptyState, Mono, Panel } from "@/components/ui";

export function MandatesPanel({ refreshKey }: { refreshKey: number }) {
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

  return (
    <Panel
      title="Mandates"
      subtitle="Spend is tracked server-side. The token only carries scope."
      bodyClassName="p-3 space-y-2"
    >
      {error ? (
        <EmptyState>{error}</EmptyState>
      ) : mandates.length === 0 ? (
        <EmptyState>No mandates issued yet.</EmptyState>
      ) : (
        mandates.map((mandate) => <BudgetMeter key={mandate.mandate_id} mandate={mandate} />)
      )}
    </Panel>
  );
}

function BudgetMeter({ mandate }: { mandate: MandateRecord }) {
  const total = mandate.total_budget_paise;
  const spent = (mandate.spent_paise / total) * 100;
  const held = (mandate.reserved_paise / total) * 100;
  const available = availablePaise(mandate);
  const expired = new Date(mandate.expires_at) <= new Date();

  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-mute-100">
          {mandate.label ?? mandate.buyer_id}
        </span>
        <span className="shrink-0 font-mono text-[11.5px] text-mute-300">
          {formatPaise(available)} left
        </span>
      </div>

      {/* spent (solid) then held (hatched) then remaining */}
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="bg-pass-500" style={{ width: `${Math.min(100, spent)}%` }} />
        <div className="bg-gate-500/70" style={{ width: `${Math.min(100 - spent, held)}%` }} />
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-mute-500">
        <span>
          <span className="inline-block size-1.5 rounded-full bg-pass-500 align-middle" /> spent{" "}
          <span className="text-mute-300">{formatPaise(mandate.spent_paise)}</span>
        </span>
        {mandate.reserved_paise > 0 && (
          <span>
            <span className="inline-block size-1.5 rounded-full bg-gate-500 align-middle" /> held{" "}
            <span className="text-mute-300">{formatPaise(mandate.reserved_paise)}</span>
          </span>
        )}
        <span>
          of <span className="text-mute-300">{formatPaise(total)}</span>
        </span>
        <span>
          cap <span className="text-mute-300">{formatPaise(mandate.per_txn_cap_paise)}</span>
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-mute-500">
        <Mono className="text-[10px]">{mandate.mandate_id}</Mono>
        <span>·</span>
        <span>{mandate.allowed_categories.join(", ")}</span>
        {mandate.revoked_at ? (
          <span className="text-fail-500">· revoked</span>
        ) : expired ? (
          <span className="text-fail-500">· expired</span>
        ) : null}
      </div>
    </div>
  );
}
