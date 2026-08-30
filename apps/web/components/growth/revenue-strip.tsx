"use client";

import { formatPaise, type RevenueMetrics } from "@vyapaar/shared-types";
import { ArrowUpRight, IndianRupee, Package, ShieldHalf, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getRevenueMetrics } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CountUp, Panel, SegmentBar, type Segment } from "@/components/ui";

/**
 * What the growth agent was actually worth.
 *
 * Every figure here is measured against a counterfactual the offer recorded when
 * it was built -- what this buyer would have paid with no offer at all -- rather
 * than asserted. A published offer nobody took is worth nothing on this strip,
 * and so is an accepted offer whose payment never cleared.
 *
 * `margin protected` is the mirror image and the number worth pointing at: the
 * discount the gauntlet refused to give away. It only exists because suppressed
 * offers are recorded rather than dropped.
 */
export function RevenueStrip({
  refreshKey,
  className,
}: {
  refreshKey: number;
  className?: string;
}) {
  const [metrics, setMetrics] = useState<RevenueMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getRevenueMetrics()
      .then((m) => {
        setMetrics(m);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(load, [load, refreshKey]);

  const uplift = metrics?.uplift_paise ?? 0;
  const upliftPct = (metrics?.uplift_bps ?? 0) / 100;
  const attachPct = (metrics?.attach_rate_bps ?? 0) / 100;

  const offerSegments: Segment[] = [
    { value: metrics?.offers_accepted ?? 0, tone: "pass", label: "accepted" },
    { value: metrics?.offers_published ?? 0, tone: "info", label: "live" },
    { value: metrics?.offers_gated ?? 0, tone: "gate", label: "gated" },
    { value: metrics?.offers_suppressed ?? 0, tone: "fail", label: "suppressed" },
  ];

  return (
    <Panel
      title="Revenue"
      subtitle="Measured against what these orders would have been worth with no offer."
      icon={<TrendingUp size={12} />}
      accent="pass"
      className={className}
      bodyClassName="p-3 space-y-3"
      actions={
        error ? (
          <span className="font-mono text-[11px] text-fail-500">offline</span>
        ) : (
          <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 font-mono text-[11px] text-mute-400">
            {metrics?.orders ?? 0} settled
          </span>
        )
      }
    >
      {/* The headline: uplift, stated as money and as a share of baseline. */}
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border p-4",
          uplift > 0
            ? "border-pass-500/25 bg-pass-500/[0.06]"
            : "border-white/[0.08] bg-white/[0.02]",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-mute-500">
              <IndianRupee size={11} />
              Revenue uplift
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={cn(
                  "font-mono text-[26px] font-semibold leading-none tracking-tight",
                  uplift > 0 ? "text-pass-500" : "text-mute-300",
                )}
              >
                <CountUp value={uplift} format={(n) => formatPaise(Math.round(n))} />
              </span>
              {upliftPct > 0 && (
                <span className="flex items-center gap-0.5 rounded-md bg-pass-500/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-pass-500">
                  <ArrowUpRight size={11} />
                  {upliftPct.toFixed(1)}%
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-mute-500">
              {formatPaise(metrics?.settled_gmv_paise ?? 0)} settled against a{" "}
              {formatPaise(metrics?.baseline_gmv_paise ?? 0)} baseline.
            </p>
          </div>

          {/* AOV with vs without an offer, side by side, because the gap is the point. */}
          <div className="shrink-0 text-right">
            <div className="text-[11px] font-medium uppercase tracking-wider text-mute-500">
              AOV
            </div>
            <div className="mt-1 font-mono text-[15px] font-semibold text-mute-100">
              {formatPaise(metrics?.aov_with_offer_paise ?? 0)}
            </div>
            <div className="text-[11px] text-mute-500">with an offer</div>
            <div className="mt-1.5 font-mono text-[13px] text-mute-400">
              {formatPaise(metrics?.aov_without_offer_paise ?? 0)}
            </div>
            <div className="text-[11px] text-mute-500">without</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MiniStat
          label="Attach rate"
          value={`${attachPct.toFixed(0)}%`}
          hint="of settled orders took an offer"
          tone="pass"
        />
        <MiniStat
          label="Discount given"
          value={formatPaise(metrics?.discount_given_paise ?? 0)}
          hint="settled, not merely offered"
          tone="gate"
        />
        <MiniStat
          label="Margin earned"
          value={formatPaise(metrics?.margin_earned_paise ?? 0)}
          hint="revenue minus cost of goods"
          tone="pass"
        />
        <MiniStat
          label="Margin protected"
          value={formatPaise(metrics?.margin_protected_paise ?? 0)}
          hint="discount the gauntlet refused"
          tone="fail"
          icon={<ShieldHalf size={11} />}
        />
      </div>

      {/* Where every offer the growth agent proposed actually ended up. */}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-mute-500">
          <span className="flex items-center gap-1.5 font-medium uppercase tracking-wider">
            <Package size={11} />
            Offers proposed
          </span>
          <span className="font-mono">
            {offerSegments.reduce((sum, s) => sum + s.value, 0)}
          </span>
        </div>
        <SegmentBar segments={offerSegments} height={7} />
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-mute-500">
          {offerSegments.map((s) => (
            <span key={s.label} className="flex items-center gap-1">
              <span
                className="inline-block size-1.5 rounded-full"
                style={{
                  background:
                    s.tone === "pass"
                      ? "var(--color-approve)"
                      : s.tone === "gate"
                        ? "var(--color-gated)"
                        : s.tone === "fail"
                          ? "var(--color-denied)"
                          : "var(--color-accent)",
                }}
              />
              {s.label} <span className="font-mono text-mute-300">{s.value}</span>
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function MiniStat({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "pass" | "gate" | "fail";
  icon?: React.ReactNode;
}) {
  const color =
    tone === "pass" ? "text-pass-500" : tone === "gate" ? "text-gate-500" : "text-fail-500";
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-mute-500">
        {icon}
        {label}
      </div>
      <div className={cn("mt-0.5 font-mono text-[15px] font-semibold", color)}>{value}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-mute-500">{hint}</div>
    </div>
  );
}
