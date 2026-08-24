"use client";

import { formatPaise, type AgentRunResult, type MandateRecord } from "@agentmandi/shared-types";
import { Bot, KeyRound, Loader2, Send } from "lucide-react";
import { useState } from "react";

import { issueQuickMandate, runAgent } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, EmptyState, Mono, Panel, toneForStatus } from "@/components/ui";

const SUGGESTIONS = [
  "buy a wireless mouse under 1500",
  "buy a mechanical keyboard",
  "buy the best noise cancelling headphones you have",
  "buy a yoga mat",
];

/** How each agent step reads in the transcript. */
const STEP_LABEL: Record<string, string> = {
  check_mandate: "mandate",
  search: "search",
  search_results: "results",
  select: "choose",
  purchase_intent: "intent",
  confirm_purchase: "checkout",
  paid: "paid",
  awaiting_payment: "awaiting",
  await_human: "gate",
  denied: "denied",
  replan: "replan",
  abandon: "stop",
  abort: "stop",
};

export function AgentConsole({ onActivity }: { onActivity: () => void }) {
  const [mandate, setMandate] = useState<MandateRecord | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [goal, setGoal] = useState(SUGGESTIONS[0]);
  const [run, setRun] = useState<AgentRunResult | null>(null);
  const [busy, setBusy] = useState<"mandate" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy("mandate");
    setError(null);
    try {
      const result = await issueQuickMandate({});
      setToken(result.mandate_token);
      setMandate(result.mandate);
      onActivity();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function go() {
    if (!token) return;
    setBusy("run");
    setError(null);
    setRun(null);
    try {
      setRun(await runAgent(goal, token));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      onActivity();
    }
  }

  return (
    <Panel
      title="Buyer agent"
      subtitle="An outside agent shopping under a bounded mandate."
      actions={
        mandate ? (
          <Badge tone="info">{formatPaise(availableOf(mandate))} left</Badge>
        ) : null
      }
      bodyClassName="p-4 space-y-3"
    >
      {!mandate ? (
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed text-mute-400">
            The agent cannot spend anything until a person grants it a mandate: a signed,
            expiring authorisation carrying a per-transaction cap, a total budget and a
            category allow-list.
          </p>
          <Button variant="primary" onClick={issue} disabled={busy !== null} className="w-full">
            {busy === "mandate" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <KeyRound size={13} />
            )}
            Grant a mandate — ₹3,000 per purchase, ₹10,000 total
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <Mono>{mandate.mandate_id}</Mono>
              <span className="text-[10.5px] text-mute-500">{mandate.buyer_id}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-mute-500">
              <span>
                cap <span className="text-mute-300">{formatPaise(mandate.per_txn_cap_paise)}</span>
              </span>
              <span>
                budget{" "}
                <span className="text-mute-300">{formatPaise(mandate.total_budget_paise)}</span>
              </span>
              <span>
                categories{" "}
                <span className="text-mute-300">{mandate.allowed_categories.join(", ")}</span>
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && go()}
                placeholder="What should the agent buy?"
                className="h-9 min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-950 px-3 text-[12.5px] text-mute-100 placeholder:text-mute-500 focus:border-brand-500 focus:outline-none"
              />
              <Button variant="primary" onClick={go} disabled={busy !== null || !goal.trim()}>
                {busy === "run" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Send size={13} />
                )}
                Run
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setGoal(s)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[10.5px] transition-colors",
                    goal === s
                      ? "border-brand-500 text-brand-400"
                      : "border-ink-600 text-mute-500 hover:border-ink-500 hover:text-mute-300",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {error && (
        <p className="rounded-lg border border-fail-500/40 bg-fail-bg px-3 py-2 text-[11.5px] leading-relaxed text-fail-500">
          {error}
        </p>
      )}

      {run && <Transcript run={run} />}

      {!run && mandate && !busy && (
        <EmptyState>The agent’s reasoning will appear here, step by step.</EmptyState>
      )}
    </Panel>
  );
}

function availableOf(m: MandateRecord) {
  return Math.max(0, m.total_budget_paise - m.spent_paise - m.reserved_paise);
}

function Transcript({ run }: { run: AgentRunResult }) {
  return (
    <div className="space-y-2.5">
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border px-3 py-2.5",
          run.outcome === "paid"
            ? "border-pass-500/40 bg-pass-bg"
            : run.outcome === "awaiting_human"
              ? "border-gate-500/40 bg-gate-bg"
              : run.outcome === "denied" || run.outcome === "error"
                ? "border-fail-500/40 bg-fail-bg"
                : "border-ink-700 bg-ink-850",
        )}
      >
        <Bot size={14} className="mt-0.5 shrink-0 text-mute-400" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <Badge tone={toneForStatus(run.outcome)}>{run.outcome.replace(/_/g, " ")}</Badge>
            <span className="text-[10.5px] text-mute-500">
              planner: {run.planner} · {run.attempts} attempt{run.attempts === 1 ? "" : "s"}
            </span>
          </div>
          <p className="text-[12px] leading-relaxed text-mute-100">{run.message}</p>
        </div>
      </div>

      <ol className="space-y-1.5">
        {run.steps.map((step) => (
          <li key={step.step} className="flex items-start gap-2">
            <Badge
              tone={
                step.action === "denied" || step.action.startsWith("ab")
                  ? "fail"
                  : step.action === "paid"
                    ? "pass"
                    : step.action === "await_human" || step.action === "replan"
                      ? "gate"
                      : "neutral"
              }
              className="mt-0.5 w-[4.6rem] shrink-0 justify-center"
            >
              {STEP_LABEL[step.action] ?? step.action}
            </Badge>
            <span className="text-[11.5px] leading-relaxed text-mute-400">{step.thought}</span>
          </li>
        ))}
      </ol>

      {run.checkout_url && (
        <a
          href={run.checkout_url}
          target="_blank"
          rel="noreferrer"
          className="block truncate rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 font-mono text-[11px] text-brand-400 hover:border-brand-500"
        >
          {run.checkout_url}
        </a>
      )}
    </div>
  );
}
