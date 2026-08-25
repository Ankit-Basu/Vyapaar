"use client";

import { formatPaise } from "@agentmandi/shared-types";
import { ArrowLeft, CircleAlert, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { API_BASE, getHealth, resetDemo, type Health } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AgentConsole } from "@/components/agent-console";
import { AuditFeed } from "@/components/audit-feed";
import { IntentsPanel } from "@/components/intents-panel";
import { MandatesPanel } from "@/components/mandates-panel";
import { ScenarioRunner } from "@/components/scenario-runner";
import { Badge, Button } from "@/components/ui";

export default function Dashboard() {
  // Bumped whenever anything happens, so the polled panels re-read.
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  return (
    <main className="relative flex h-dvh flex-col gap-3 overflow-hidden p-3">
      <div className="aurora" aria-hidden />
      <div className="grain" aria-hidden />

      <Header onReset={bump} refreshKey={tick} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="flex min-h-0 flex-col gap-3 lg:col-span-4">
          <AgentConsole onActivity={bump} />
          <ScenarioRunner onActivity={bump} />
        </div>

        <div className="flex min-h-0 flex-col gap-3 lg:col-span-4">
          <IntentsPanel refreshKey={tick} />
          <MandatesPanel refreshKey={tick} />
        </div>

        <div className="flex min-h-0 lg:col-span-4">
          {/* The feed drives its own refreshes off the SSE stream. */}
          <AuditFeed onEvent={bump} />
        </div>
      </div>
    </main>
  );
}

function Header({ onReset, refreshKey }: { onReset: () => void; refreshKey: number }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    getHealth()
      .then((h) => {
        setHealth(h);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, [refreshKey]);

  async function reset() {
    setResetting(true);
    try {
      await resetDemo();
      onReset();
    } finally {
      setResetting(false);
    }
  }

  return (
    <header className="glass flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-2.5">
      <Link href="/" className="group flex items-center gap-2.5" title="Back to the overview">
        <span className="relative grid size-7 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-[13px] font-bold text-white shadow-lg shadow-brand-500/25">
          <span className="transition-opacity group-hover:opacity-0">₹</span>
          <ArrowLeft
            size={13}
            className="absolute opacity-0 transition-opacity group-hover:opacity-100"
          />
        </span>
        <span>
          <h1 className="text-[14px] leading-tight font-semibold tracking-tight">AgentMandi</h1>
          <p className="text-[10.5px] leading-tight text-mute-500">
            Agent commerce layer · Kirana Labs
          </p>
        </span>
      </Link>

      {offline ? (
        <span className="flex items-center gap-1.5 rounded-md bg-fail-bg px-2 py-1 text-[11px] text-fail-500">
          <CircleAlert size={12} />
          API unreachable at {API_BASE}
        </span>
      ) : (
        health && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-mute-500">
              <Field label="payments">
                <span
                  className={
                    health.payments_mode === "live" ? "text-pass-500" : "text-mute-300"
                  }
                >
                  {health.payments_mode === "live"
                    ? "Razorpay test mode"
                    : "local simulator"}
                </span>
              </Field>
              <Field label="agent planner">
                <span className="text-mute-300">{health.llm_model}</span>
              </Field>
              <Field label="human gate at">
                <span className="text-gate-500">
                  {formatPaise(health.hitl_threshold_paise)}
                </span>
              </Field>
              <Field label="catalog">
                <span className="text-mute-300">{health.catalog_products} products</span>
              </Field>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-semibold",
                  health.audit_chain_valid
                    ? "bg-pass-bg text-pass-500"
                    : "bg-fail-bg text-fail-500",
                )}
              >
                <ShieldCheck size={11} />
                {health.audit_chain_valid ? "chain intact" : "chain broken"}
              </span>
              {health.warnings.map((warning) => (
                <Badge key={warning} tone="gate" title={warning}>
                  dev secret
                </Badge>
              ))}
              <Button size="sm" variant="ghost" onClick={reset} disabled={resetting}>
                <RotateCcw size={11} className={resetting ? "animate-spin" : undefined} />
                Reset demo
              </Button>
            </div>
          </>
        )
      )}
    </header>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-[9.5px] uppercase tracking-wider text-mute-500">{label}</span>
      {children}
    </span>
  );
}
