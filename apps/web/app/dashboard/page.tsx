"use client";

import { formatPaise } from "@agentmandi/shared-types";
import {
  ArrowLeft,
  Bot,
  Boxes,
  CircleAlert,
  Cpu,
  CreditCard,
  FlaskConical,
  LayoutGrid,
  ListChecks,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  UserCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  API_BASE,
  getHealth,
  getIntents,
  getMandates,
  resetDemo,
  type Health,
} from "@/lib/api";
import { useAuditStream } from "@/lib/use-audit-stream";
import { cn } from "@/lib/utils";
import { MoltenBackground } from "@/components/glass/molten-background";
import { ThemeSwitcher } from "@/components/glass/theme";
import { AgentConsole } from "@/components/agent-console";
import { AuditFeed } from "@/components/audit-feed";
import { DashboardNav, type NavItem, type ViewId } from "@/components/dashboard-nav";
import { IntentsPanel } from "@/components/intents-panel";
import { LiveMetrics } from "@/components/live-metrics";
import { MandatesPanel } from "@/components/mandates-panel";
import { ScenarioRunner } from "@/components/scenario-runner";
import { Badge, Button, LiveDot } from "@/components/ui";

/**
 * Counts for the rail.
 *
 * Each panel fetches its own records, but the rail has to report what is
 * happening in the sections you are *not* looking at. Without it, focusing one
 * view means going blind to the rest — a worse problem than the density it set
 * out to fix.
 */
function useSectionCounts(refreshKey: number) {
  const [counts, setCounts] = useState({ intents: 0, gated: 0, liveMandates: 0 });

  useEffect(() => {
    let cancelled = false;
    Promise.all([getIntents(60), getMandates()])
      .then(([intents, mandates]) => {
        if (cancelled) return;
        const now = new Date();
        setCounts({
          intents: intents.length,
          gated: intents.filter((i) => i.status === "GATED").length,
          liveMandates: mandates.filter((m) => !m.revoked_at && new Date(m.expires_at) > now)
            .length,
        });
      })
      .catch(() => {
        /* the header already reports an unreachable API; the rail just goes quiet */
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return counts;
}

export default function Dashboard() {
  // Bumped whenever the operator does something, so the polled panels re-read.
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const [view, setView] = useState<ViewId>("overview");

  // One subscription, several readers: the feed renders the rows, the strip
  // above renders what they add up to, the rail counts them.
  const { events, connection } = useAuditStream();

  // An event arriving is also a reason to re-read the panels, which is why the
  // stream's depth is folded into the same key.
  const refreshKey = tick + events.length;
  const counts = useSectionCounts(refreshKey);

  const items = useMemo<NavItem[]>(
    () => [
      {
        id: "overview",
        label: "Overview",
        icon: LayoutGrid,
        hint: "Every panel at once",
        count: null,
      },
      { id: "agent", label: "Buyer agent", icon: Bot, hint: "…the agent shops", count: null },
      {
        id: "intents",
        label: "Purchase intents",
        icon: ListChecks,
        hint: "…guardrails decide",
        count: counts.intents,
        // The only thing on this screen that is genuinely waiting on a person.
        tone: "gate",
        urgent: counts.gated > 0,
      },
      {
        id: "mandates",
        label: "Mandates",
        icon: Wallet,
        hint: "Consent is granted…",
        count: counts.liveMandates,
        tone: "pass",
      },
      {
        id: "audit",
        label: "Audit trail",
        icon: ScrollText,
        hint: "…and it is all recorded",
        count: events.length,
      },
      {
        id: "scenarios",
        label: "Scenarios",
        icon: FlaskConical,
        hint: "Seven scripted runs",
        count: null,
      },
    ],
    [counts, events.length],
  );

  /*
   * Every view fills the same full-height twelve-column grid, and each pairs its
   * subject with the panel that explains it — intents beside the trail that
   * records them, the agent beside the mandate it spends from. That pairing is
   * what keeps a focused view from being one panel and a lot of empty room.
   */
  const panes: Record<ViewId, ReactNode> = {
    overview: (
      <>
        <div className="flex min-h-0 min-w-0 flex-col gap-3.5 xl:col-span-4 xl:gap-5">
          <AgentConsole onActivity={bump} refreshKey={refreshKey} className="flex-[1.15]" />
          <ScenarioRunner onActivity={bump} className="flex-1" />
        </div>
        <div className="flex min-h-0 min-w-0 flex-col gap-3.5 xl:col-span-4 xl:gap-5">
          <IntentsPanel refreshKey={refreshKey} className="flex-[1.25]" />
          <MandatesPanel refreshKey={refreshKey} className="flex-1" />
        </div>
        <div className="flex min-h-0 min-w-0 xl:col-span-4">
          <AuditFeed events={events} connection={connection} />
        </div>
      </>
    ),
    agent: (
      <>
        <div className="flex min-h-0 min-w-0 xl:col-span-7">
          <AgentConsole onActivity={bump} refreshKey={refreshKey} className="flex-1" />
        </div>
        <div className="flex min-h-0 min-w-0 xl:col-span-5">
          <MandatesPanel refreshKey={refreshKey} className="flex-1" />
        </div>
      </>
    ),
    intents: (
      <>
        <div className="flex min-h-0 min-w-0 xl:col-span-8">
          <IntentsPanel refreshKey={refreshKey} className="flex-1" />
        </div>
        <div className="flex min-h-0 min-w-0 xl:col-span-4">
          <AuditFeed events={events} connection={connection} />
        </div>
      </>
    ),
    mandates: (
      <>
        <div className="flex min-h-0 min-w-0 xl:col-span-7">
          <MandatesPanel refreshKey={refreshKey} className="flex-1" />
        </div>
        <div className="flex min-h-0 min-w-0 xl:col-span-5">
          <AgentConsole onActivity={bump} refreshKey={refreshKey} className="flex-1" />
        </div>
      </>
    ),
    audit: (
      <>
        <div className="flex min-h-0 min-w-0 xl:col-span-8">
          <AuditFeed events={events} connection={connection} />
        </div>
        <div className="flex min-h-0 min-w-0 xl:col-span-4">
          <IntentsPanel refreshKey={refreshKey} className="flex-1" />
        </div>
      </>
    ),
    scenarios: (
      <>
        <div className="flex min-h-0 min-w-0 xl:col-span-7">
          <ScenarioRunner onActivity={bump} className="flex-1" />
        </div>
        <div className="flex min-h-0 min-w-0 xl:col-span-5">
          <AuditFeed events={events} connection={connection} />
        </div>
      </>
    ),
  };

  return (
    <main className="relative flex h-dvh flex-col gap-3.5 overflow-hidden p-3.5 lg:flex-row xl:gap-5 xl:p-5">
      <MoltenBackground opacity={0.55} speed={0.18} scale={5} />

      <DashboardNav items={items} active={view} connection={connection} onSelect={setView} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 xl:gap-5">
        <Header onReset={bump} refreshKey={refreshKey} connection={connection} />

        {/* The pulse stays put across views: changing section should never mean
            losing the numbers the room is actually judged by. */}
        <LiveMetrics events={events} connection={connection} />

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 xl:grid-cols-12 xl:gap-5">
          {panes[view]}
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
    <header className="glass-surface glass-d3 relative z-40 flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2.5 rounded-2xl border border-white/[0.09] px-5 py-3 shadow-xl backdrop-blur-2xl">
      <div
        className="absolute inset-x-0 top-0 h-px rounded-t-2xl"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--color-brand-500), var(--color-violet-400), var(--color-brand-500), transparent)",
          backgroundSize: "200% 100%",
          animation: "divider-travel 6s ease-in-out infinite",
          opacity: 0.8,
        }}
        aria-hidden
      />

      {/* The rail carries the wordmark on wide screens, so this only shows where
          the rail has collapsed into a horizontal strip. */}
      <Link
        href="/"
        className="group flex items-center gap-3 lg:hidden"
        title="Back to the overview"
      >
        <span className="relative grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 via-brand-400 to-violet-500 text-[15px] font-bold text-white shadow-lg shadow-brand-500/30">
          <span className="relative transition-opacity group-hover:opacity-0">₹</span>
          <ArrowLeft
            size={15}
            className="absolute opacity-0 transition-opacity group-hover:opacity-100"
          />
        </span>
        <span>
          <h1 className="text-[14px] leading-tight font-semibold tracking-tight text-mute-100">
            AgentMandi
          </h1>
          <p className="text-[11px] leading-tight text-mute-400">Agent commerce layer</p>
        </span>
      </Link>

      {offline ? (
        <span className="flex items-center gap-1.5 rounded-xl border border-fail-500/30 bg-fail-bg/60 px-3 py-1.5 text-[12px] font-medium text-fail-500 shadow-sm">
          <CircleAlert size={13} />
          API unreachable at {API_BASE}
        </span>
      ) : (
        health && (
          <div className="flex flex-wrap items-stretch divide-x divide-white/[0.07] rounded-xl border border-white/[0.07] bg-white/[0.02]">
            <Chip
              icon={CreditCard}
              label="payments"
              value={health.payments_mode === "live" ? "Razorpay test mode" : "local simulator"}
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
    <span className="flex items-center gap-2 px-3 py-1.5 transition-colors first:rounded-l-xl last:rounded-r-xl hover:bg-white/[0.04]">
      <Icon size={12} className="shrink-0 text-mute-500" />
      <span className="flex flex-col leading-tight">
        <span className="text-[10px] font-medium tracking-[0.14em] text-mute-500 uppercase">
          {label}
        </span>
        <span className={cn("text-[11px]", valueTone)}>{value}</span>
      </span>
    </span>
  );
}
