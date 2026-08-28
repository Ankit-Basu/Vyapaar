"use client";

import {
  availablePaise,
  formatPaise,
  type AgentRunResult,
  type MandateRecord,
} from "@agentmandi/shared-types";
import { Bot, KeyRound, Loader2, Send, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { getMandates, issueQuickMandate, runAgent } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  EmptyState,
  Mono,
  Panel,
  Ring,
  TONE_COLOR,
  toneForStatus,
  type Tone,
} from "@/components/ui";

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

function toneForStep(action: string): Tone {
  if (action === "denied" || action.startsWith("ab")) return "fail";
  if (action === "paid") return "pass";
  if (action === "await_human" || action === "replan") return "gate";
  return "info";
}

export function AgentConsole({
  onActivity,
  refreshKey,
  className,
}: {
  onActivity: () => void;
  refreshKey: number;
  className?: string;
}) {
  const [mandate, setMandate] = useState<MandateRecord | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [goal, setGoal] = useState(SUGGESTIONS[0]);
  const [run, setRun] = useState<AgentRunResult | null>(null);
  const [busy, setBusy] = useState<"mandate" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped per run so the transcript remounts and replays its stagger, rather
  // than React reusing the previous run's rows and skipping the animation.
  const [runSeq, setRunSeq] = useState(0);

  /*
   * Re-read the mandate whenever anything happens.
   *
   * The record returned at issuance is a snapshot, and the headline figure on
   * this panel is what is *still* spendable — a number the server moves every
   * time the agent commits or settles. Without this the dial would keep
   * reporting the full budget next to a run that had just spent from it.
   */
  // Keyed on the id rather than the record, so writing the fresh record back
  // does not re-trigger the effect that fetched it.
  const mandateId = mandate?.mandate_id ?? null;
  useEffect(() => {
    if (!mandateId) return;
    let cancelled = false;
    getMandates()
      .then((rows) => {
        const fresh = rows.find((row) => row.mandate_id === mandateId);
        if (fresh && !cancelled) setMandate(fresh);
      })
      .catch(() => {
        /* keep the last known record; the mandates panel is the authority */
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, mandateId]);

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
      const result = await runAgent(goal, token);
      setRun(result);
      setRunSeq((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      onActivity();
    }
  }

  const available = mandate ? availablePaise(mandate) : 0;
  const headroom = mandate && mandate.total_budget_paise > 0
    ? available / mandate.total_budget_paise
    : 0;

  return (
    <Panel
      title="Buyer agent"
      subtitle="An outside agent shopping under a bounded mandate."
      icon={<Bot size={12} />}
      accent="info"
      className={className}
      actions={
        mandate ? (
          <span className="flex items-center gap-1.5">
            <Ring value={headroom} tone={headroom < 0.2 ? "fail" : "pass"} size={16} stroke={2.5} />
            <Badge tone="info">{formatPaise(available)} left</Badge>
          </span>
        ) : null
      }
      bodyClassName="p-4 space-y-3"
    >
      {!mandate ? (
        <div className="space-y-3.5 rounded-xl border border-brand-500/20 bg-gradient-to-b from-brand-500/10 to-transparent p-4 backdrop-blur-md">
          <p className="text-[12px] leading-relaxed text-mute-300">
            The agent cannot spend anything until a person grants it a mandate: a signed,
            expiring authorisation carrying a per-transaction cap, a total budget and a
            category allow-list.
          </p>
          <Button variant="primary" onClick={issue} disabled={busy !== null} className="w-full shadow-lg shadow-brand-500/25">
            {busy === "mandate" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <KeyRound size={14} />
            )}
            Grant a mandate — ₹3,000 per purchase, ₹10,000 total
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 shadow-inner">
            <div className="flex items-center justify-between gap-2">
              <Mono className="text-brand-300 font-semibold">{mandate.mandate_id}</Mono>
              <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-mute-400">{mandate.buyer_id}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-mute-400">
              <span>
                cap <span className="font-mono font-semibold text-mute-200">{formatPaise(mandate.per_txn_cap_paise)}</span>
              </span>
              <span>
                budget{" "}
                <span className="font-mono font-semibold text-mute-200">{formatPaise(mandate.total_budget_paise)}</span>
              </span>
              <span>
                categories{" "}
                <span className="text-mute-300 font-medium">{mandate.allowed_categories.join(", ")}</span>
              </span>
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex gap-2">
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && go()}
                placeholder="What should the agent buy?"
                className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3.5 text-[13px] text-mute-100 transition-colors placeholder:text-mute-500 hover:border-white/20 focus:border-brand-500 focus:bg-black/60 focus:outline-none shadow-inner"
              />
              <Button variant="primary" onClick={go} disabled={busy !== null || !goal.trim()} className="px-5">
                {busy === "run" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
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
                    "lift rounded-lg border px-2.5 py-1 text-[11px] transition-all",
                    goal === s
                      ? "border-brand-500/50 bg-brand-500/20 text-brand-300 font-medium shadow-sm shadow-brand-500/10"
                      : "border-white/[0.08] bg-white/[0.03] text-mute-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-mute-200",
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

      {busy === "run" && <Thinking goal={goal} />}

      {run && busy !== "run" && <Transcript key={runSeq} run={run} />}

      {!run && mandate && !busy && (
        <EmptyState icon={<Sparkles size={16} />}>
          The agent&rsquo;s reasoning will appear here, step by step.
        </EmptyState>
      )}
    </Panel>
  );
}

/** What the panel shows between "Run" and the first line of the transcript. */
function Thinking({ goal }: { goal: string }) {
  return (
    <div className="space-y-2.5 rounded-lg border border-brand-500/25 bg-brand-glow px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Bot size={14} className="shrink-0 text-brand-400" />
        <span className="flex-1 truncate text-[12px] text-mute-200">{goal}</span>
        <span className="animate-thinking flex gap-1">
          <span className="size-1.5 rounded-full bg-brand-400" />
          <span className="size-1.5 rounded-full bg-brand-400" />
          <span className="size-1.5 rounded-full bg-brand-400" />
        </span>
      </div>
      <div className="space-y-1.5">
        {[80, 62, 71].map((width, i) => (
          <div key={i} className="relative h-2 overflow-hidden rounded bg-white/[0.06]" style={{ width: `${width}%` }}>
            <span
              className="animate-shimmer absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
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
                : "border-white/[0.07] bg-white/[0.03]",
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

      {/*
       * The plan as a thread: a node per step on a connecting line, revealed in
       * the order the agent actually took them.
       */}
      <ol className="space-y-2">
        {run.steps.map((step, index) => {
          const tone = toneForStep(step.action);
          const last = index === run.steps.length - 1;
          return (
            <li
              key={step.step}
              className="animate-step-in relative flex items-start gap-2.5 pl-[18px]"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              {!last && (
                <span
                  className="absolute top-[13px] bottom-[-13px] left-[4px] w-px bg-white/[0.09]"
                  aria-hidden
                />
              )}
              <span
                className="absolute top-[5px] left-0 size-[9px] rounded-full ring-[2.5px] ring-ink-950"
                style={{ background: TONE_COLOR[tone] }}
                aria-hidden
              />
              <Badge tone={tone} className="w-[4.6rem] shrink-0 justify-center">
                {STEP_LABEL[step.action] ?? step.action}
              </Badge>
              <span className="text-[11.5px] leading-relaxed text-mute-400">{step.thought}</span>
            </li>
          );
        })}
      </ol>

      {run.checkout_url && (
        <a
          href={run.checkout_url}
          target="_blank"
          rel="noreferrer"
          className="lift block truncate rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-brand-400 hover:border-brand-500"
        >
          {run.checkout_url}
        </a>
      )}
    </div>
  );
}
