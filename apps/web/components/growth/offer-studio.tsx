"use client";

import {
  formatPaise,
  type OfferListResponse,
  type OfferQuote,
  type Product,
} from "@vyapaar/shared-types";
import {
  Ban,
  Boxes,
  ChevronDown,
  Layers,
  Sparkles,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getCatalogFeed, getOffers, issueQuickMandate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, EmptyState, Mono, Panel } from "@/components/ui";

/**
 * The offer studio.
 *
 * One panel that shows the whole sell-side argument: pick a product, choose how
 * much authority the visiting agent carries, and watch the merchant decide what
 * it is willing to offer *that* buyer.
 *
 * The three mandate modes are the demo. The same product under a tight mandate
 * and a roomy one produces different shelves, because `buyer_bounds` refuses to
 * offer a purchase the buyer is not allowed to accept. Anonymous is the control:
 * no mandate, so nothing is fitted and the buy-side gauntlet judges it later.
 */

type MandateMode = "none" | "tight" | "roomy";

const MODES: { id: MandateMode; label: string; detail: string }[] = [
  { id: "none", label: "Anonymous", detail: "No mandate. Offers are published unfitted." },
  { id: "tight", label: "Tight mandate", detail: "₹1,500 per purchase, electronics only." },
  { id: "roomy", label: "Roomy mandate", detail: "₹3,000 per purchase, electronics + office." },
];

/** Anchors worth demoing: a thin-margin hero, a roomy one, and a gate-tripper. */
const SUGGESTED = ["prod_elec_001", "prod_home_003", "prod_offc_005"];

const KIND_ICON = {
  bundle: Layers,
  volume: Boxes,
  upgrade: TrendingUp,
} as const;

export function OfferStudio({
  onActivity,
  className,
}: {
  onActivity?: () => void;
  className?: string;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState(SUGGESTED[0]);
  const [mode, setMode] = useState<MandateMode>("none");
  const [result, setResult] = useState<OfferListResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCatalogFeed(200)
      .then((feed) => setProducts(feed.products))
      .catch(() => setProducts([]));
  }, []);

  const product = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  );

  const ask = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      let token: string | undefined;
      if (mode !== "none") {
        const issued = await issueQuickMandate(
          mode === "tight"
            ? {
                buyer_id: "buyer_tight",
                per_txn_cap_paise: 150_000,
                total_budget_paise: 400_000,
                allowed_categories: ["electronics"],
              }
            : {
                buyer_id: "buyer_roomy",
                per_txn_cap_paise: 300_000,
                total_budget_paise: 1_000_000,
                allowed_categories: ["electronics", "office"],
              },
        );
        token = issued.mandate_token;
      }
      setResult(await getOffers(productId, token));
      onActivity?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [mode, productId, onActivity]);

  return (
    <Panel
      title="Offer"
      subtitle="What the merchant will offer this buyer — and what it refuses to."
      icon={<Sparkles size={12} />}
      accent="gate"
      className={className}
      bodyClassName="p-3 space-y-3"
      actions={
        result ? (
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 font-mono text-[11px]",
              result.mandate_aware
                ? "bg-pass-500/15 text-pass-500"
                : "bg-white/[0.07] text-mute-400",
            )}
          >
            {result.mandate_aware ? "fitted to mandate" : "unfitted"}
          </span>
        ) : null
      }
    >
      {/* ------------------------------------------------------------ controls */}
      <div className="space-y-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wider text-mute-500">
            Product the agent is about to buy
          </span>
          <div className="relative mt-1.5">
            <select
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                setResult(null);
              }}
              className="w-full appearance-none rounded-xl border border-white/[0.1] bg-surface-2 px-3 py-2 pr-9 text-[13px] text-mute-100 outline-none transition-colors focus:border-brand-400/60"
            >
              {products.length === 0 && <option value={productId}>Loading catalog…</option>}
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} — {formatPaise(p.price_paise)}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-mute-500"
            />
          </div>
        </label>

        <div>
          <span className="text-[11px] font-medium uppercase tracking-wider text-mute-500">
            How much authority the agent carries
          </span>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMode(m.id);
                  setResult(null);
                }}
                title={m.detail}
                className={cn(
                  "rounded-xl border px-2 py-2 text-[12px] font-medium transition-colors",
                  mode === m.id
                    ? "border-brand-400/50 bg-brand-400/10 text-brand-300"
                    : "border-white/[0.08] bg-white/[0.02] text-mute-400 hover:border-white/20 hover:text-mute-200",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-mute-500">
            {MODES.find((m) => m.id === mode)?.detail}
          </p>
        </div>

        <Button onClick={ask} disabled={busy || products.length === 0} className="w-full">
          {busy ? "Asking the merchant…" : "Ask the merchant for offers"}
        </Button>
      </div>

      {/* ------------------------------------------------------------- results */}
      {error && <EmptyState icon={<Ban size={16} />}>{error}</EmptyState>}

      {!result && !error && (
        <EmptyState icon={<Sparkles size={16} />}>
          Pick a product and an authority level, then ask. Run the same product twice — once
          anonymous, once under the tight mandate — and watch the shelf change.
        </EmptyState>
      )}

      {result && (
        <div className="space-y-2">
          {result.offers.map((offer) => (
            <OfferCard key={offer.offer_id} offer={offer} anchor={product} />
          ))}

          {result.withheld.map((w, i) => (
            <WithheldCard key={(w.offer_id as string) ?? i} withheld={w} />
          ))}

          {result.offers.length === 0 && result.withheld.length === 0 && (
            <EmptyState icon={<Ban size={16} />}>
              The growth agent found nothing worth offering on this product.
            </EmptyState>
          )}
        </div>
      )}
    </Panel>
  );
}

function OfferCard({ offer, anchor }: { offer: OfferQuote; anchor: Product | null }) {
  const Icon = KIND_ICON[offer.kind];
  return (
    <div className="rounded-2xl border border-pass-500/25 bg-pass-500/[0.05] p-3.5 transition-colors hover:border-pass-500/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-pass-500/15 text-pass-500">
            <Icon size={13} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone="pass">{offer.kind}</Badge>
              <span className="font-mono text-[11px] text-pass-500">published</span>
            </div>
            <p className="mt-1 text-[13px] font-semibold leading-snug text-mute-100">
              {offer.headline}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[15px] font-semibold text-mute-100">
            {formatPaise(offer.offer_total_paise)}
          </div>
          <div className="font-mono text-[11px] text-mute-500 line-through">
            {formatPaise(offer.list_total_paise)}
          </div>
          <div className="mt-0.5 font-mono text-[11px] font-semibold text-pass-500">
            −{formatPaise(offer.discount_paise)} ({(offer.discount_bps / 100).toFixed(1)}%)
          </div>
        </div>
      </div>

      {/* Line-by-line, so the arithmetic is checkable on screen. */}
      <div className="mt-2.5 space-y-1 rounded-xl bg-black/20 p-2">
        {offer.lines.map((line) => (
          <div
            key={line.product_id}
            className="flex items-center justify-between gap-2 text-[11px]"
          >
            <span className="min-w-0 truncate text-mute-300">
              {line.qty} × {line.title}
              {line.is_anchor && <span className="ml-1 text-mute-500">(anchor)</span>}
            </span>
            <Mono className="shrink-0 text-mute-400">{formatPaise(line.line_total_paise)}</Mono>
          </div>
        ))}
        {anchor && (
          <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-1 text-[11px]">
            <span className="text-mute-500">would have paid</span>
            <Mono className="text-mute-500">{formatPaise(anchor.price_paise)}</Mono>
          </div>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-mute-400">{offer.disclosure}</p>
    </div>
  );
}

function WithheldCard({ withheld }: { withheld: Record<string, unknown> }) {
  const failed = String(withheld.failed_check ?? "guardrail");
  const gated = failed === "deep_discount_gate";
  return (
    <div
      className={cn(
        "rounded-2xl border p-3",
        gated
          ? "border-gate-500/25 bg-gate-500/[0.05]"
          : "border-fail-500/20 bg-fail-500/[0.04]",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-lg",
            gated ? "bg-gate-500/15 text-gate-500" : "bg-fail-500/15 text-fail-500",
          )}
        >
          {gated ? <UserCheck size={12} /> : <Ban size={12} />}
        </span>
        <Badge tone={gated ? "gate" : "fail"}>{String(withheld.kind ?? "offer")}</Badge>
        <Mono className={gated ? "text-gate-500" : "text-fail-500"}>{failed}</Mono>
      </div>
      <p className="mt-1.5 text-[12px] font-medium text-mute-200">
        {String(withheld.headline ?? "")}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-mute-400">
        {String(withheld.reason ?? "")}
      </p>
    </div>
  );
}
