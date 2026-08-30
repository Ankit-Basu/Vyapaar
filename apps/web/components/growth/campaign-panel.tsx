"use client";

import { formatPaise, type Campaign, type RebalanceMove } from "@vyapaar/shared-types";
import { Megaphone, Pause, Play, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getCampaigns, rebalanceCampaign, setCampaignStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, CountUp, EmptyState, Mono, Panel, type Tone } from "@/components/ui";

/**
 * The merchant's mandate, pointed the other way.
 *
 * A campaign is a signed-off envelope of discount the growth agent may give
 * away, with a margin floor underneath and a human gate above. The meter reads
 * the same way a buyer's budget meter does — given, held, remaining — because it
 * is the same three-phase ledger: a discount is only really given away once the
 * payment it rode on clears.
 */
export function CampaignPanel({
  refreshKey,
  onActivity,
  className,
}: {
  refreshKey: number;
  onActivity?: () => void;
  className?: string;
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [moves, setMoves] = useState<RebalanceMove[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getCampaigns()
      .then((rows) => {
        setCampaigns(rows);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(load, [load, refreshKey]);

  const active = campaigns.find((c) => c.status === "ACTIVE") ?? campaigns[0] ?? null;

  const rebalance = useCallback(async () => {
    setBusy(true);
    try {
      const result = await rebalanceCampaign();
      setMoves(result.moves);
      setSummary(result.summary);
      onActivity?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [onActivity]);

  const toggle = useCallback(async () => {
    if (!active) return;
    setBusy(true);
    try {
      await setCampaignStatus(
        active.campaign_id,
        active.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
      );
      load();
      onActivity?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [active, load, onActivity]);

  return (
    <Panel
      title="Campaign"
      subtitle="How much discount the merchant has authorised, and what is left of it."
      icon={<Megaphone size={12} />}
      accent="gate"
      className={className}
      bodyClassName="p-3 space-y-3"
      actions={
        active ? (
          <Badge tone={active.status === "ACTIVE" ? "pass" : "skip"}>{active.status}</Badge>
        ) : null
      }
    >
      {error ? (
        <EmptyState icon={<Megaphone size={16} />}>{error}</EmptyState>
      ) : !active ? (
        <EmptyState icon={<Megaphone size={16} />}>
          No campaign is open. A merchant with no campaign makes no offers at all.
        </EmptyState>
      ) : (
        <>
          <DiscountMeter campaign={active} />

          <div className="grid grid-cols-3 gap-2">
            <Bound
              label="Max discount"
              value={`${(active.max_discount_bps / 100).toFixed(0)}%`}
              hint="ceiling on any one offer"
            />
            <Bound
              label="Margin floor"
              value={`${(active.floor_margin_bps / 100).toFixed(0)}%`}
              hint="never sold below this"
            />
            <Bound
              label="Human gate"
              value={formatPaise(active.deep_discount_gate_paise)}
              hint="deeper needs sign-off"
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={rebalance} disabled={busy} className="flex-1">
              <RefreshCw size={13} className={cn(busy && "animate-spin")} />
              Rebalance
            </Button>
            <Button variant="ghost" onClick={toggle} disabled={busy}>
              {active.status === "ACTIVE" ? <Pause size={13} /> : <Play size={13} />}
              {active.status === "ACTIVE" ? "Pause" : "Resume"}
            </Button>
          </div>

          {summary && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
              <p className="text-[11px] leading-relaxed text-mute-300">{summary}</p>
              <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
                {moves.slice(0, 12).map((move) => (
                  <MoveRow key={move.product_id} move={move} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function DiscountMeter({ campaign }: { campaign: Campaign }) {
  const total = campaign.discount_budget_paise;
  const givenPct = total > 0 ? (campaign.discount_spent_paise / total) * 100 : 0;
  const heldPct = total > 0 ? (campaign.discount_reserved_paise / total) * 100 : 0;
  const available =
    total - campaign.discount_spent_paise - campaign.discount_reserved_paise;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[13px] font-semibold text-mute-100">{campaign.name}</span>
        <span className="shrink-0 font-mono text-[13px] font-semibold text-mute-200">
          <CountUp value={Math.max(0, available)} format={(n) => formatPaise(Math.round(n))} />{" "}
          <span className="text-[11px] font-normal text-mute-400">left to give</span>
        </span>
      </div>

      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/10 shadow-inner">
        <div
          className="bar-fill bg-gradient-to-r from-gate-500 to-brand-400"
          style={{ width: `${Math.min(100, givenPct)}%` }}
        />
        <div
          className="bar-fill relative overflow-hidden bg-gate-500/50"
          style={{ width: `${Math.max(0, Math.min(100 - givenPct, heldPct))}%` }}
        >
          <span className="animate-shimmer absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[11px] text-mute-400">
        <span>
          <span className="inline-block size-1.5 rounded-full bg-gate-500 align-middle" /> given{" "}
          <span className="font-mono font-medium text-mute-200">
            {formatPaise(campaign.discount_spent_paise)}
          </span>
        </span>
        {campaign.discount_reserved_paise > 0 && (
          <span>
            <span className="inline-block size-1.5 rounded-full bg-gate-500/50 align-middle" />{" "}
            held{" "}
            <span className="font-mono font-medium text-mute-200">
              {formatPaise(campaign.discount_reserved_paise)}
            </span>
          </span>
        )}
        <span>
          of <span className="font-mono font-medium text-mute-200">{formatPaise(total)}</span>
        </span>
      </div>

      <div className="mt-2.5 border-t border-white/[0.06] pt-2">
        <Mono className="text-brand-300">{campaign.campaign_id}</Mono>
        <span className="ml-2 text-[11px] text-mute-500">
          {campaign.allowed_categories.length > 0
            ? campaign.allowed_categories.join(", ")
            : "whole catalog"}
        </span>
      </div>
    </div>
  );
}

function MoveRow({ move }: { move: RebalanceMove }) {
  const promote = move.action === "promote";
  const tone: Tone = promote ? "pass" : "fail";
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span
        className={cn(
          "mt-0.5 shrink-0",
          promote ? "text-pass-500" : "text-fail-500",
        )}
      >
        {promote ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      </span>
      <div className="min-w-0">
        <span className="font-medium text-mute-200">{move.title}</span>
        <Badge tone={tone} className="ml-1.5 !py-0 !text-[10px]">
          {move.action}
        </Badge>
        <p className="text-mute-500">{move.reason}</p>
      </div>
    </div>
  );
}

/** One bound the growth agent operates inside. Three of these are the whole envelope. */
function Bound({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-2.5 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wider text-mute-500">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[14px] font-semibold text-mute-100">{value}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-mute-500">{hint}</div>
    </div>
  );
}
