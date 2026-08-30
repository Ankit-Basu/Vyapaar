"use client";

import { formatPaise, type Decision, type PurchaseIntent } from "@vyapaar/shared-types";
import { Check, ChevronRight, CreditCard, ListChecks, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getDecision,
  getIntents,
  getPaymentForIntent,
  resolveGate,
  simulatePayment,
  type ApiError,
} from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  SegmentBar,
  TONE_COLOR,
  toneForStatus,
  type Segment,
} from "@/components/ui";

export function IntentsPanel({
  refreshKey,
  className,
}: {
  refreshKey: number;
  className?: string;
}) {
  const [intents, setIntents] = useState<PurchaseIntent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getIntents(60)
      .then((rows) => {
        setIntents(rows);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(load, [load, refreshKey]);

  const gated = intents.filter((i) => i.status === "GATED");

  // A one-line read on where every intent ended up, without leaving the header.
  const mix = useMemo<Segment[]>(() => {
    const count = (...statuses: string[]) =>
      intents.filter((i) => statuses.includes(i.status)).length;
    return [
      { value: count("PAID"), tone: "pass", label: "paid" },
      { value: count("GATED", "APPROVED", "PENDING"), tone: "gate", label: "in flight" },
      { value: count("DENIED", "FAILED"), tone: "fail", label: "denied or failed" },
      { value: count("EXPIRED"), tone: "skip", label: "expired" },
    ];
  }, [intents]);

  return (
    <Panel
      title="Purchase intents"
      subtitle="Every check, in order, with the reason it passed or failed."
      icon={<ListChecks size={12} />}
      accent="gate"
      className={className}
      bodyClassName="p-0"
      actions={
        gated.length > 0 ? (
          <Badge tone="gate" className="animate-pulse-dot">
            {gated.length} awaiting {gated.length === 1 ? "a human" : "humans"}
          </Badge>
        ) : null
      }
      toolbar={
        intents.length > 0 ? (
          <div className="flex w-full items-center gap-3">
            <SegmentBar className="flex-1" segments={mix} height={5} />
            <span className="shrink-0 font-mono text-[10px] text-mute-500">
              {intents.length} total
            </span>
          </div>
        ) : undefined
      }
    >
      {error ? (
        <EmptyState icon={<ListChecks size={16} />}>{error}</EmptyState>
      ) : intents.length === 0 ? (
        <EmptyState icon={<ListChecks size={16} />}>
          No intents yet. Give the agent a goal, or run a scenario, and they appear here.
        </EmptyState>
      ) : (
        <ol className="divide-y divide-white/[0.05]">
          {intents.map((intent) => (
            <IntentRow key={intent.intent_id} intent={intent} onChanged={load} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function IntentRow({ intent, onChanged }: { intent: PurchaseIntent; onChanged: () => void }) {
  const [open, setOpen] = useState(intent.status === "GATED");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const tone = toneForStatus(intent.status);

  useEffect(() => {
    if (!open || decision) return;
    getDecision(intent.intent_id)
      .then(setDecision)
      .catch(() => setDecision(null));
  }, [open, decision, intent.intent_id]);

  async function resolve(approve: boolean) {
    setBusy(approve ? "approve" : "reject");
    setNote(null);
    try {
      const result = await resolveGate(intent.intent_id, approve);
      setDecision(result.decision);
      setNote(result.next_action);
      onChanged();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Settle (or decline) the checkout that was opened for this intent. */
  async function settle(outcome: "success" | "failure") {
    setBusy(outcome);
    setNote(null);
    try {
      const payment = await getPaymentForIntent(intent.intent_id);
      if (!payment.rzp_payment_link_id) {
        setNote("No payment link has been opened for this intent yet.");
        return;
      }
      if (payment.mode !== "simulated") {
        setNote(
          "Real Razorpay test keys are configured, so pay the Razorpay link instead. " +
            "The simulator is disabled to keep the two paths from being confused.",
        );
        return;
      }
      await simulatePayment(payment.rzp_payment_link_id, outcome);
      onChanged();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="row-hover relative px-4 py-3 transition-colors hover:bg-white/[0.04]">
      {/* A status rail down the left edge */}
      <span
        className="absolute inset-y-2 left-0 w-1 rounded-r-full shadow-sm"
        style={{ background: TONE_COLOR[tone], boxShadow: `0 0 8px ${TONE_COLOR[tone]}` }}
        aria-hidden
      />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <ChevronRight
          size={14}
          className={cn(
            "shrink-0 text-mute-400 transition-transform duration-200",
            open && "rotate-90 text-mute-100",
          )}
        />
        <Badge tone={tone}>{intent.status}</Badge>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-mute-100">
          {intent.qty > 1 && <span className="text-mute-400 font-normal">{intent.qty} × </span>}
          {intent.product_title}
        </span>
        <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-mute-200">
          {formatPaise(intent.amount_paise)}
        </span>
        <span className="hidden shrink-0 font-mono text-[11px] text-mute-500 2xl:inline">
          {timeAgo(intent.created_at)}
        </span>
      </button>

      <div className="expandable" data-open={open}>
        <div>
          <div className="mt-3 ml-[1.4rem] space-y-3">
            {intent.agent_rationale && (
              <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-[12px] leading-relaxed text-mute-300 shadow-inner [overflow-wrap:anywhere]">
                <span className="font-semibold text-brand-300">Agent&rsquo;s reason: </span>
                {intent.agent_rationale}
              </p>
            )}

            {decision ? (
              <ol className="space-y-1.5 rounded-xl border border-white/[0.06] bg-black/20 p-2.5">
                {decision.checks.map((check, index) => (
                  <li
                    key={check.id}
                    className={cn("flex items-start gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-white/[0.02]", open && "animate-step-in")}
                    style={open ? { animationDelay: `${index * 45}ms` } : undefined}
                  >
                    <span className="mt-0.5 w-3.5 shrink-0 text-right font-mono text-[10px] text-mute-500">
                      {index + 1}
                    </span>
                    <Badge tone={toneForStatus(check.status)} className="mt-0.5 shrink-0">
                      {check.status}
                    </Badge>
                    <span className="text-[12px] leading-relaxed text-mute-300 [overflow-wrap:anywhere]">
                      <span className="font-semibold text-mute-100">{check.name}</span>
                      <span className="block text-[12px] text-mute-400">{check.reason}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="flex items-center gap-1.5 text-[12px] text-mute-400">
                <span className="animate-thinking flex gap-1">
                  <span className="size-1 rounded-full bg-brand-400" />
                  <span className="size-1 rounded-full bg-brand-400" />
                  <span className="size-1 rounded-full bg-brand-400" />
                </span>
                Loading decision guardrails…
              </p>
            )}

            {intent.status === "GATED" && (
              <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-gate-500/40 bg-gate-bg/70 p-3 shadow-lg shadow-gate-500/10">
                <span className="flex-1 text-[12px] leading-relaxed text-gate-400">
                  Held for human review. <strong className="text-gate-300 font-mono">{formatPaise(intent.reserved_paise)}</strong> is reserved while you
                  decide.
                </span>
                <Button
                  size="sm"
                  variant="approve"
                  disabled={busy !== null}
                  onClick={() => resolve(true)}
                  className="shadow-md shadow-pass-500/20"
                >
                  {busy === "approve" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Check size={12} />
                  )}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="reject"
                  disabled={busy !== null}
                  onClick={() => resolve(false)}
                >
                  {busy === "reject" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <X size={12} />
                  )}
                  Reject
                </Button>
              </div>
            )}

            {intent.status === "APPROVED" && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
                <span className="flex-1 text-[12px] leading-relaxed text-mute-400 [overflow-wrap:anywhere]">
                  Approved and awaiting payment. It becomes PAID only when a webhook with a valid
                  signature arrives.
                </span>
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={busy !== null}
                  onClick={() => settle("success")}
                >
                  {busy === "success" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <CreditCard size={12} />
                  )}
                  Pay with test card
                </Button>
                <Button
                  size="sm"
                  variant="reject"
                  disabled={busy !== null}
                  onClick={() => settle("failure")}
                >
                  {busy === "failure" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <X size={12} />
                  )}
                  Decline the card
                </Button>
              </div>
            )}

            {note && (
              <p className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-mute-300 [overflow-wrap:anywhere]">
                {note}
              </p>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
