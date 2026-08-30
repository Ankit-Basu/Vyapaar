"use client";

import type { Scenario } from "@vyapaar/shared-types";
import { ChevronRight, FlaskConical, Loader2, Play } from "lucide-react";
import { useEffect, useState } from "react";

import { getScenarios, runScenario } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  toneForStatus,
  type Tone,
} from "@/components/ui";

/** What each scenario is meant to demonstrate, mapped onto a colour. */
const PROVES_TONE: Record<string, Tone> = {
  "transactable end to end": "pass",
  "graceful failure": "fail",
  gated: "gate",
  bounded: "info",
  "explainable, bounded": "info",
};

type Result = { outcome: string; summary: string };

export function ScenarioRunner({
  onActivity,
  className,
}: {
  onActivity: () => void;
  className?: string;
}) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [queued, setQueued] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getScenarios()
      .then((r) => setScenarios(r.scenarios))
      .catch((e) => setError((e as Error).message));
  }, []);

  async function run(id: string) {
    setRunning(id);
    setError(null);
    try {
      const result = await runScenario(id);
      setResults((current) => ({
        ...current,
        [id]: { outcome: result.outcome, summary: result.summary },
      }));
      setExpanded(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(null);
      onActivity();
    }
  }

  /**
   * The whole suite, in order. Sequential rather than parallel on purpose: they
   * share one audit chain and one budget, and watching them land one after
   * another is the point of the panel.
   */
  async function runAll() {
    const runnable = scenarios.filter((s) => s.runnable).map((s) => s.id);
    setQueued(runnable);
    for (const id of runnable) {
      await run(id);
      setQueued((rest) => rest.slice(1));
    }
    setQueued([]);
  }

  // Between two scenarios in a "Run all" there is a tick where nothing is
  // running yet; the queue is what keeps the controls disabled across it.
  const locked = running !== null || queued.length > 0;
  const done = scenarios.filter((s) => results[s.id]).length;

  return (
    <Panel
      title="Demo scenarios"
      subtitle="Each one runs the real services. Nothing is mocked."
      icon={<FlaskConical size={12} />}
      accent="gate"
      className={className}
      bodyClassName="p-3 space-y-1.5"
      actions={
        scenarios.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-mute-500">
              {done}/{scenarios.length}
            </span>
            <Button size="sm" variant="subtle" onClick={runAll} disabled={locked}>
              {queued.length > 0 ? (
                <>
                  <Loader2 size={11} className="animate-spin" />
                  {queued.length} left
                </>
              ) : (
                <>
                  <Play size={11} />
                  Run all
                </>
              )}
            </Button>
          </div>
        ) : null
      }
    >
      {error && (
        <p className="rounded-lg border border-fail-500/40 bg-fail-bg px-3 py-2 text-[12px] text-fail-500">
          {error}
        </p>
      )}
      {scenarios.length === 0 && !error && (
        <EmptyState icon={<FlaskConical size={16} />}>Loading scenarios…</EmptyState>
      )}

      {scenarios.map((scenario) => {
        const result = results[scenario.id];
        const isOpen = expanded === scenario.id;
        const isRunning = running === scenario.id;
        const isQueued = queued.includes(scenario.id) && !isRunning;

        return (
          <div
            key={scenario.id}
            className={cn(
              "lift relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3.5 shadow-sm backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/[0.04]",
              isRunning && "border-brand-500/60 shadow-md shadow-brand-500/10",
              isQueued && "opacity-60",
            )}
          >
            <div className="flex items-start gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-mute-100">
                    {scenario.title}
                  </span>
                  <Badge tone={PROVES_TONE[scenario.proves] ?? "neutral"}>{scenario.proves}</Badge>
                  {result && <Badge tone={toneForStatus(result.outcome)}>{result.outcome}</Badge>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : scenario.id)}
                className="shrink-0 rounded-lg p-1.5 text-mute-400 transition-colors hover:bg-white/[0.06] hover:text-mute-100"
                aria-label="Details"
                aria-expanded={isOpen}
              >
                <ChevronRight
                  size={14}
                  className={cn("transition-transform duration-200", isOpen && "rotate-90 text-mute-100")}
                />
              </button>
              <Button
                size="sm"
                variant={result ? "ghost" : "primary"}
                disabled={locked || !scenario.runnable}
                onClick={() => run(scenario.id)}
                className={cn(!result && "shadow-sm shadow-brand-500/20")}
              >
                {isRunning ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Play size={12} />
                )}
                {result ? "Again" : "Run"}
              </Button>
            </div>

            <div className="expandable" data-open={isOpen}>
              <div>
                <div className="mt-3 space-y-2.5 border-t border-white/[0.07] pt-2.5">
                  <p className="text-[12px] leading-relaxed text-mute-300">
                    {scenario.narrative}
                  </p>
                  {scenario.watch_for.length > 0 && (
                    <ul className="space-y-1 rounded-xl bg-black/20 p-2.5 border border-white/[0.04]">
                      {scenario.watch_for.map((item, i) => (
                        <li
                          key={i}
                          className="flex gap-2 text-[12px] leading-relaxed text-mute-400"
                        >
                          <span className="text-brand-400 font-bold">→</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                  {result && (
                    <p className="rounded-xl border border-white/[0.08] bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-mute-300 shadow-inner">
                      <span className="font-semibold text-brand-300">{result.outcome}: </span>
                      {result.summary}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* A scenario in flight is calling the real services; say so. */}
            {isRunning && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-brand-500/20">
                <span className="animate-shimmer absolute inset-0 bg-gradient-to-r from-transparent via-brand-400 to-transparent" />
              </span>
            )}
          </div>
        );
      })}
    </Panel>
  );
}
