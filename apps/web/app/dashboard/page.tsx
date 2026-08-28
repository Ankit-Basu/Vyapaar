"use client";

import { formatPaise } from "@agentmandi/shared-types";
import {
  ArrowLeft,
  Boxes,
  CircleAlert,
  Cpu,
  CreditCard,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { API_BASE, getHealth, resetDemo, type Health } from "@/lib/api";
import { useAuditStream } from "@/lib/use-audit-stream";
import { cn } from "@/lib/utils";
import { MoltenBackground } from "@/components/glass/molten-background";
import { ThemeSwitcher } from "@/components/glass/theme";
import { AgentConsole } from "@/components/agent-console";
import { AuditFeed } from "@/components/audit-feed";
import { IntentsPanel } from "@/components/intents-panel";
import { LiveMetrics } from "@/components/live-metrics";
import { MandatesPanel } from "@/components/mandates-panel";
import { ScenarioRunner } from "@/components/scenario-runner";
import { Badge, Button, LiveDot } from "@/components/ui";

export default function Dashboard() {
  // Bumped whenever the operator does something, so the polled panels re-read.
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  // One subscription, two readers: the feed renders the rows, the strip above
  // renders what they add up to.
  const { events, connection } = useAuditStream();

  // An event arriving is also a reason to re-read the panels, which is why the
  // stream's depth is folded into the same key.
  const refreshKey = tick + events.length;

  return (
    <main className="relative flex h-dvh flex-col gap-3 overflow-hidden p-3">
      <MoltenBackground opacity={0.55} speed={0.18} scale={5} />

      <Header onReset={bump} refreshKey={refreshKey} connection={connection} />

      <LiveMetrics events={events} connection={connection} />

      {/*
       * Each column divides its own height by weight rather than by content, so
       * the grid holds still as data arrives and no column ends in dead space.
       * Every panel scrolls internally, so the weights never cause a clip.
       */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="flex min-h-0 flex-col gap-3 lg:col-span-4">
          <AgentConsole onActivity={bump} refreshKey={refreshKey} className="flex-[1.15]" />
          <ScenarioRunner onActivity={bump} className="flex-1" />
        </div>

        <div className="flex min-h-0 flex-col gap-3 lg:col-span-4">
          <IntentsPanel refreshKey={refreshKey} className="flex-[1.25]" />
          <MandatesPanel refreshKey={refreshKey} className="flex-1" />
        </div>

        <div className="flex min-h-0 lg:col-span-4">
          <AuditFeed events={events} connection={connection} />
        </div>
      </div>
    </main>
  );
}

function Header({
  onReset,
  refreshKey,
  connection,
}: {
  onReset: () => void;
  refreshKey: number;
  connection: "connecting" | "live" | "offline";
}) {
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
    } catch {
      // The API being unreachable is already stated in the header; an unhandled
      // rejection on top of it helps nobody.
      setOffline(true);
    } finally {
      setResetting(false);
    }
  }

  return (
    <header className="glass-surface glass-d3 relative z-40 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl border border-white/[0.09] px-4.5 py-3 shadow-xl backdrop-blur-2xl">
      {/* Animated top accent line */}
      <div
        className="absolute inset-x-0 top-0 h-px rounded-t-2xl"
        style={{
          background: "linear-gradient(90deg, transparent, var(--color-brand-500), var(--color-violet-400), var(--color-brand-500), transparent)",
          backgroundSize: "200% 100%",
          animation: "divider-travel 6s ease-in-out infinite",
          opacity: 0.8,
        }}
      />
      <Link href="/" className="group flex items-center gap-3" title="Back to the overview">
        <span className="relative grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 via-brand-400 to-violet-500 text-[15px] font-bold text-white shadow-lg shadow-brand-500/30 transition-transform group-hover:scale-105">
          <span className="absolute inset-0 rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 opacity-60 blur-md" />
          <span className="relative transition-opacity group-hover:opacity-0">₹</span>
          <ArrowLeft
            size={15}
            className="absolute opacity-0 transition-opacity group-hover:opacity-100"
          />
        </span>
        <span>
          <h1 className="flex items-center gap-2 text-[14.5px] leading-tight font-semibold tracking-tight text-mute-100">
            AgentMandi
            <span className="rounded-md border border-brand-500/30 bg-brand-500/15 px-1.5 py-0.5 text-[8.5px] font-bold tracking-[0.14em] text-brand-300 uppercase">
              control room
            </span>
          </h1>
          <p className="text-[11px] leading-tight text-mute-400">
            Agent commerce layer · Kirana Labs
          </p>
        </span>
      </Link>

      {offline ? (
        <span className="flex items-center gap-1.5 rounded-xl border border-fail-500/30 bg-fail-bg/60 px-3 py-1.5 text-[11.5px] font-medium text-fail-500 shadow-sm">
          <CircleAlert size={13} />
          API unreachable at {API_BASE}
        </span>
      ) : (
        health && (
          <div className="flex flex-wrap items-center gap-2">
            <Chip
              icon={CreditCard}
              label="payments"
              value={
                health.payments_mode === "live" ? "Razorpay test mode" : "local simulator"
              }
              tone={health.payments_mode === "live" ? "pass" : "mute"}
            />
            <Chip icon={Cpu} label="planner" value={health.llm_model} tone="mute" />
            <Chip
              icon={UserCheck}
              label="human gate"
              value={formatPaise(health.hitl_threshold_paise)}
              tone="gate"
            />
            <Chip
              icon={Boxes}
              label="catalog"
              value={`${health.catalog_products} products`}
              tone="mute"
            />
          </div>
        )
      )}

      {/* Action controls */}
      <div className="ml-auto flex items-center gap-2.5">
        <span className="hidden items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-mute-300 shadow-sm sm:inline-flex">
          <LiveDot
            tone={connection === "live" ? "pass" : connection === "offline" ? "fail" : "gate"}
            active={connection === "live"}
          />
          {connection === "live" ? "streaming" : connection}
        </span>
        {health && !offline && (
          <>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold shadow-sm",
                health.audit_chain_valid
                  ? "border-pass-500/30 bg-pass-bg/60 text-pass-500 shadow-pass-500/10"
                  : "border-fail-500/30 bg-fail-bg/60 text-fail-500",
              )}
              title={`${health.audit_events} events recorded since the last reset`}
            >
              <ShieldCheck size={13} />
              {health.audit_chain_valid ? "chain intact" : "chain broken"}
            </span>
            {health.warnings.map((warning) => (
              <Badge key={warning} tone="gate" title={warning}>
                dev secret
              </Badge>
            ))}
          </>
        )}
        <ThemeSwitcher />
        <Button size="sm" variant="ghost" onClick={reset} disabled={resetting || offline}>
          <RotateCcw size={12} className={resetting ? "animate-spin" : undefined} />
          Reset demo
        </Button>
      </div>
    </header>
  );
}

/** One piece of run configuration, as a compact labelled chip. */
function Chip({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: "pass" | "gate" | "mute";
}) {
  const valueTone = {
    pass: "text-pass-500 font-semibold",
    gate: "text-gate-500 font-semibold",
    mute: "text-mute-200",
  }[tone];

  return (
    <span className="lift flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 backdrop-blur-md transition-colors hover:border-white/20 hover:bg-white/[0.06]">
      <Icon size={12} className="shrink-0 text-mute-400" />
      <span className="flex flex-col leading-tight">
        <span className="text-[8.5px] font-medium tracking-[0.14em] text-mute-500 uppercase">{label}</span>
        <span className={cn("text-[11px]", valueTone)}>{value}</span>
      </span>
    </span>
  );
}
