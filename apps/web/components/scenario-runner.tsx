"use client";

import type { Scenario } from "@agentmandi/shared-types";
import { Eye, Loader2, Play } from "lucide-react";
import { useEffect, useState } from "react";

import { getScenarios, runScenario } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, EmptyState, Panel, toneForStatus } from "@/components/ui";

/** What each scenario is meant to demonstrate, mapped onto a colour. */
const PROVES_TONE: Record<string, Parameters<typeof Badge>[0]["tone"]> = {
  "transactable end to end": "pass",
  "graceful failure": "fail",
  gated: "gate",
  bounded: "info",
  "explainable, bounded": "info",
};

export function ScenarioRunner({ onActivity }: { onActivity: () => void }) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { outcome: string; summary: string }>>({});
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

  return (
    <Panel
      title="Demo scenarios"
      subtitle="Each one runs the real services. Nothing is mocked."
      bodyClassName="p-3 space-y-1.5"
    >
      {error && (
        <p className="rounded-lg border border-fail-500/40 bg-fail-bg px-3 py-2 text-[11.5px] text-fail-500">
          {error}
        </p>
      )}
      {scenarios.length === 0 && !error && <EmptyState>Loading scenarios…</EmptyState>}

      {scenarios.map((scenario) => {
        const result = results[scenario.id];
        const isOpen = expanded === scenario.id;
        return (
          <div
            key={scenario.id}
            className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12.5px] font-medium text-mute-100">
                    {scenario.title}
                  </span>
                  <Badge tone={PROVES_TONE[scenario.proves] ?? "neutral"}>{scenario.proves}</Badge>
                  {result && (
                    <Badge tone={toneForStatus(result.outcome)}>{result.outcome}</Badge>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : scenario.id)}
                className="shrink-0 rounded p-1 text-mute-500 hover:text-mute-300"
                aria-label="Details"
              >
                <Eye size={13} />
              </button>
              <Button
                size="sm"
                variant={result ? "ghost" : "subtle"}
                disabled={running !== null || !scenario.runnable}
                onClick={() => run(scenario.id)}
              >
                {running === scenario.id ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Play size={11} />
                )}
                {result ? "Again" : "Run"}
              </Button>
            </div>

            {isOpen && (
              <div className="mt-2 space-y-2 border-t border-ink-700 pt-2">
                <p className="text-[11.5px] leading-relaxed text-mute-400">{scenario.narrative}</p>
                {scenario.watch_for.length > 0 && (
                  <ul className="space-y-0.5">
                    {scenario.watch_for.map((item, i) => (
                      <li
                        key={i}
                        className="flex gap-1.5 text-[11px] leading-relaxed text-mute-500"
                      >
                        <span className="text-brand-500">→</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
                {result && (
                  <p
                    className={cn(
                      "rounded-md border px-2.5 py-2 text-[11.5px] leading-relaxed",
                      toneForStatus(result.outcome) === "fail"
                        ? "border-fail-500/40 bg-fail-bg text-fail-500"
                        : "border-ink-600 bg-ink-900 text-mute-300",
                    )}
                  >
                    {result.summary}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
}
