"use client";

import { formatPaise, type Decision, type PurchaseIntent } from "@agentmandi/shared-types";
import { Check, ChevronRight, CreditCard, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  getDecision,
  getIntents,
  getPaymentForIntent,
  resolveGate,
  simulatePayment,
  type ApiError,
} from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { Badge, Button, EmptyState, Panel, toneForStatus } from "@/components/ui";

export function IntentsPanel({ refreshKey }: { refreshKey: number }) {
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

  return (
    <Panel
      title="Purchase intents"
      subtitle="Every check, in order, with the reason it passed or failed."
      bodyClassName="p-0"
      actions={
        gated.length > 0 ? (
          <Badge tone="gate">
            {gated.length} awaiting {gated.length === 1 ? "a human" : "humans"}
          </Badge>
        ) : null
      }
    >
      {error ? (
        <EmptyState>{error}</EmptyState>
      ) : intents.length === 0 ? (
        <EmptyState>
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

function IntentRow({
  intent,
  onChanged,
}: {
  intent: PurchaseIntent;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(intent.status === "GATED");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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
    <li className="px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <ChevronRight
          size={13}
          className={cn("shrink-0 text-mute-500 transition-transform", open && "rotate-90")}
        />
        <Badge tone={toneForStatus(intent.status)}>{intent.status}</Badge>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-mute-100">
          {intent.qty > 1 && <span className="text-mute-400">{intent.qty} × </span>}
          {intent.product_title}
        </span>
        <span className="shrink-0 font-mono text-[12px] text-mute-300">
          {formatPaise(intent.amount_paise)}
        </span>
        <span className="hidden shrink-0 text-[10.5px] text-mute-500 sm:inline">
          {timeAgo(intent.created_at)}
        </span>
      </button>

      {open && (
        <div className="mt-2.5 ml-[1.4rem] space-y-2.5">
          {intent.agent_rationale && (
            <p className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[11.5px] leading-relaxed text-mute-300">
              <span className="font-medium text-mute-400">Agent’s reason: </span>
              {intent.agent_rationale}
            </p>
          )}

          {decision ? (
            <ol className="space-y-1">
              {decision.checks.map((check, index) => (
                <li key={check.id} className="flex items-start gap-2">
                  <span className="mt-1 w-3 shrink-0 text-right font-mono text-[10px] text-mute-500">
                    {index + 1}
                  </span>
                  <Badge tone={toneForStatus(check.status)} className="mt-0.5 shrink-0">
                    {check.status}
                  </Badge>
                  <span className="text-[11.5px] leading-relaxed text-mute-400">
                    <span className="font-medium text-mute-300">{check.name}</span>
                    <span className="block">{check.reason}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[11.5px] text-mute-500">Loading the decision…</p>
          )}

          {intent.status === "GATED" && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gate-500/40 bg-gate-bg px-3 py-2.5">
              <span className="flex-1 text-[11.5px] leading-relaxed text-gate-500">
                Held for human review. {formatPaise(intent.reserved_paise)} is reserved while you
                decide, so nothing else can spend it.
              </span>
              <Button
                size="sm"
                variant="approve"
                disabled={busy !== null}
                onClick={() => resolve(true)}
              >
                {busy === "approve" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Approve
              </Button>
              <Button
                size="sm"
                variant="reject"
                disabled={busy !== null}
                onClick={() => resolve(false)}
              >
                {busy === "reject" ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                Reject
              </Button>
            </div>
          )}

          {intent.status === "APPROVED" && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
              <span className="flex-1 text-[11.5px] leading-relaxed text-mute-400">
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
            <p className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[11.5px] leading-relaxed text-mute-300">
              {note}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
