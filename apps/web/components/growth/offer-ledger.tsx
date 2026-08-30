"use client";

import {
  formatPaise,
  type EvaluatedOffer,
  type OfferCheck,
  type OfferStatus,
} from "@vyapaar/shared-types";
import { Check, ChevronRight, Minus, ReceiptText, ShieldAlert, UserCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getOfferLedger, resolveOfferGate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, EmptyState, Mono, Panel, type Tone } from "@/components/ui";

/**
 * Every offer the growth agent proposed, and the gauntlet that judged it.
 *
 * Suppressed offers are listed alongside published ones on purpose. An offer the
 * merchant refused to make is the most interesting row on this panel — it is
 * where the margin floor, the campaign budget or the buyer's own mandate can be
 * seen doing work, and it is the only reason `margin protected` is a real number
 * rather than a slogan.
 *
 * Margins appear here and nowhere agent-facing. This is a merchant view.
 */

const STATUS_TONE: Record<OfferStatus, Tone> = {
  PUBLISHED: "info",
  ACCEPTED: "pass",
  GATED: "gate",
  SUPPRESSED: "fail",
  DECLINED: "skip",
  EXPIRED: "skip",
};

const CHECK_ICON = {
  pass: Check,
  fail: X,
  gate: UserCheck,
  skipped: Minus,
} as const;

export function OfferLedger({
  refreshKey,
  onActivity,
  className,
}: {
  refreshKey: number;
  onActivity?: () => void;
  className?: string;
}) {
  const [offers, setOffers] = useState<EvaluatedOffer[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "refused" | "gated">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getOfferLedger(60)
      .then((rows) => {
        setOffers(rows);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(load, [load, refreshKey]);

  const resolve = useCallback(
    async (offerId: string, approve: boolean) => {
      setBusy(offerId);
      try {
        await resolveOfferGate(offerId, approve);
        load();
        onActivity?.();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [load, onActivity],
  );

  const shown = offers.filter((e) =>
    filter === "all"
      ? true
      : filter === "gated"
        ? e.offer.status === "GATED"
        : e.offer.status === "SUPPRESSED",
  );
  const gatedCount = offers.filter((e) => e.offer.status === "GATED").length;

  return (
    <Panel
      title="Offer"
      subtitle="Every offer proposed, and the guardrail that published or refused it."
      icon={<ReceiptText size={12} />}
      accent="info"
      className={className}
      bodyClassName="p-3 space-y-2"
      toolbar={
        <div className="flex gap-1">
          {(["all", "gated", "refused"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-lg px-2 py-1 text-[11px] font-medium transition-colors",
                filter === f
                  ? "bg-white/[0.1] text-mute-100"
                  : "text-mute-500 hover:text-mute-300",
              )}
            >
              {f}
              {f === "gated" && gatedCount > 0 && (
                <span className="ml-1 font-mono text-gate-500">{gatedCount}</span>
              )}
            </button>
          ))}
        </div>
      }
    >
      {error ? (
        <EmptyState icon={<ShieldAlert size={16} />}>{error}</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon={<ReceiptText size={16} />}>
          {offers.length === 0
            ? "No offers proposed yet. Ask the merchant for offers in the Offer studio."
            : `No ${filter} offers.`}
        </EmptyState>
      ) : (
        shown.map((evaluated) => (
          <OfferRow
            key={evaluated.offer.offer_id}
            evaluated={evaluated}
            expanded={open === evaluated.offer.offer_id}
            busy={busy === evaluated.offer.offer_id}
            onToggle={() =>
              setOpen(open === evaluated.offer.offer_id ? null : evaluated.offer.offer_id)
            }
            onResolve={(approve) => resolve(evaluated.offer.offer_id, approve)}
          />
        ))
      )}
    </Panel>
  );
}

function OfferRow({
  evaluated,
  expanded,
  busy,
  onToggle,
  onResolve,
}: {
  evaluated: EvaluatedOffer;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onResolve: (approve: boolean) => void;
}) {
  const { offer, decision } = evaluated;
  const tone = STATUS_TONE[offer.status];
  const failed = decision.checks.find((c) => c.status === "fail" || c.status === "gate");

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white/[0.02] transition-colors",
        offer.status === "GATED"
          ? "border-gate-500/25"
          : offer.status === "SUPPRESSED"
            ? "border-fail-500/20"
            : "border-white/[0.08] hover:border-white/20",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-2.5 p-3 text-left"
      >
        <ChevronRight
          size={13}
          className={cn(
            "mt-1 shrink-0 text-mute-500 transition-transform",
            expanded && "rotate-90",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={tone}>{offer.status}</Badge>
            <Mono className="text-mute-400">{offer.kind}</Mono>
            {failed && (
              <Mono
                className={failed.status === "gate" ? "text-gate-500" : "text-fail-500"}
              >
                {failed.id}
              </Mono>
            )}
          </div>
          <p className="mt-1 truncate text-[13px] font-medium text-mute-100">
            {offer.headline}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-mute-500">
            <span>
              pay{" "}
              <span className="font-mono text-mute-200">
                {formatPaise(offer.offer_total_paise)}
              </span>
            </span>
            <span>
              off{" "}
              <span className="font-mono text-gate-500">
                {formatPaise(offer.discount_paise)}
              </span>{" "}
              ({(offer.discount_bps / 100).toFixed(1)}%)
            </span>
            {evaluated.margin_paise !== null && (
              <span>
                margin{" "}
                <span className="font-mono text-pass-500">
                  {formatPaise(evaluated.margin_paise)}
                </span>
                {evaluated.margin_bps !== null && (
                  <span className="text-mute-500">
                    {" "}
                    ({(evaluated.margin_bps / 100).toFixed(1)}%)
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06] px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-mute-500">
              Margin gauntlet
            </span>
            <Mono className="text-mute-500">{decision.policy_version}</Mono>
          </div>
          <div className="space-y-1.5">
            {decision.checks.map((check, i) => (
              <CheckRow key={check.id} check={check} index={i + 1} />
            ))}
          </div>

          {offer.status === "GATED" && (
            <div className="mt-3 flex gap-2 border-t border-white/[0.06] pt-2.5">
              <Button onClick={() => onResolve(true)} disabled={busy} className="flex-1">
                Approve the discount
              </Button>
              <Button variant="ghost" onClick={() => onResolve(false)} disabled={busy}>
                Reject
              </Button>
            </div>
          )}
          {offer.status === "GATED" && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-mute-500">
              Approving re-runs every other guardrail against current state first. A person
              waives the depth of the discount, not the margin floor.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CheckRow({ check, index }: { check: OfferCheck; index: number }) {
  const Icon = CHECK_ICON[check.status];
  const color =
    check.status === "pass"
      ? "text-pass-500"
      : check.status === "fail"
        ? "text-fail-500"
        : check.status === "gate"
          ? "text-gate-500"
          : "text-skip-500";

  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-[10px] text-mute-600">
        {index}
      </span>
      <span className={cn("mt-0.5 shrink-0", color)}>
        <Icon size={12} />
      </span>
      <div className="min-w-0">
        <Mono className={cn("font-medium", color)}>{check.id}</Mono>
        <p className="text-[11px] leading-relaxed text-mute-400">{check.reason}</p>
      </div>
    </div>
  );
}
