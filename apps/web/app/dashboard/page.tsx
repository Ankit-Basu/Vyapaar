"use client";

import { formatPaise } from "@vyapaar/shared-types";
import {
  Bot,
  Boxes,
  CircleAlert,
  Cpu,
  CreditCard,
  FlaskConical,
  LayoutGrid,
  ListChecks,
  ScrollText,
  ShieldCheck,
  Tag,
  TrendingUp,
  UserCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  API_BASE,
  getHealth,
  getIntents,
  getMandates,
  getOfferLedger,
  resetDemo,
  type Health,
} from "@/lib/api";
import { useAuditStream } from "@/lib/use-audit-stream";
import { cn } from "@/lib/utils";
import { MoltenBackground } from "@/components/glass/molten-background";
import { AgentConsole } from "@/components/agent-console";
import { CampaignPanel } from "@/components/growth/campaign-panel";
import { OfferLedger } from "@/components/growth/offer-ledger";
import { OfferStudio } from "@/components/growth/offer-studio";
import { RevenueStrip } from "@/components/growth/revenue-strip";
import { AuditFeed } from "@/components/audit-feed";
import { DashboardNav, type NavGroup, type ViewId } from "@/components/dashboard-nav";
import { IntentsPanel } from "@/components/intents-panel";
import { LiveMetrics } from "@/components/live-metrics";
import { MandatesPanel } from "@/components/mandates-panel";
import { ScenarioRunner } from "@/components/scenario-runner";
import { Badge, LiveDot } from "@/components/ui";

/** What each view is called in the page title, and what it is for. */
const VIEW_META: Record<ViewId, { title: string; accent: string; blurb: string }> = {
  overview: {
    title: "Dashboard",
    accent: "Overview",
    blurb: "Every panel at once — the view to leave open while the agent works.",
  },
  agent: {
    title: "Buyer",
    accent: "Agent",
    blurb:
      "An outside agent shopping under a bounded mandate, beside the budget it spends from.",
  },
  intents: {
    title: "Purchase",
    accent: "Intents",
    blurb: "Every guardrail, in order, with the reason it passed or failed.",
  },
  mandates: {
    title: "Signed",
    accent: "Mandates",
    blurb:
      "Scope lives in the token. Spend is tracked server-side, where the holder cannot edit it.",
  },
  growth: {
    title: "Revenue",
    accent: "Growth",
    blurb:
      "The merchant's side of the counter. A discount is a money action too, so it clears its own gauntlet.",
  },
  offers: {
    title: "Offer",
    accent: "Ledger",
    blurb:
      "Every offer proposed, published or refused — with the margin guardrail that decided.",
  },
  audit: {
    title: "Audit",
    accent: "Trail",
    blurb: "Append-only and hash-chained. Edit one row and every row after it stops verifying.",
  },
  scenarios: {
    title: "Demo",
    accent: "Scenarios",
    blurb: "Seven scripted runs against the real services — three of them failures, handled.",
  },
};

/**
 * Counts for the rail.
 *
 * Each panel fetches its own records, but the rail has to report what is
 * happening in the sections you are *not* looking at. Without it, focusing one
 * view means going blind to the rest — a worse problem than the density it set
 * out to fix.
 */
function useSectionCounts(refreshKey: number) {
  const [counts, setCounts] = useState({
    intents: 0,
    gated: 0,
    liveMandates: 0,
    offers: 0,
    gatedOffers: 0,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([getIntents(60), getMandates(), getOfferLedger(60)])
      .then(([intents, mandates, offers]) => {
        if (cancelled) return;
        const now = new Date();
        setCounts({
          intents: intents.length,
          gated: intents.filter((i) => i.status === "GATED").length,
          liveMandates: mandates.filter((m) => !m.revoked_at && new Date(m.expires_at) > now)
            .length,
          offers: offers.length,
          gatedOffers: offers.filter((o) => o.offer.status === "GATED").length,
        });
      })
      .catch(() => {
        /* the top bar already reports an unreachable API; the rail goes quiet */
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

  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [resetting, setResetting] = useState(false);

  // One subscription, several readers: the feed renders the rows, the strip
  // renders what they add up to, the rail counts them.
  const { events, connection } = useAuditStream();

  // An event arriving is also a reason to re-read the panels, which is why the
  // stream's depth is folded into the same key.
  const refreshKey = tick + events.length;
  const counts = useSectionCounts(refreshKey);

  useEffect(() => {
    getHealth()
      .then((h) => {
        setHealth(h);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, [refreshKey]);

  const reset = useCallback(async () => {
    if (resetting) return;
    setResetting(true);
    try {
      await resetDemo();
      bump();
    } finally {
      setResetting(false);
    }
  }, [bump, resetting]);

  const meta = VIEW_META[view];

  const groups = useMemo<NavGroup[]>(
    () => [
      {
        heading: "Main",
        items: [
          { id: "overview", label: "Overview", icon: LayoutGrid, count: null },
          { id: "audit", label: "Audit trail", icon: ScrollText, count: events.length },
        ],
      },
      {
        heading: "The path of a rupee",
        items: [
          {
            id: "mandates",
            label: "Mandates",
            icon: Wallet,
            count: counts.liveMandates,
            tone: "pass",
          },
          { id: "agent", label: "Buyer agent", icon: Bot, count: null },
          {
            id: "intents",
            label: "Purchase intents",
            icon: ListChecks,
            count: counts.intents,
            // The only thing on this screen genuinely waiting on a person.
            tone: "gate",
            urgent: counts.gated > 0,
          },
        ],
      },
      {
        heading: "Growing the merchant",
        items: [
          { id: "growth", label: "Revenue & campaign", icon: TrendingUp, count: null, tone: "pass" },
          {
            id: "offers",
            label: "Offer ledger",
            icon: Tag,
            count: counts.offers,
            tone: "gate",
            // Deep discounts wait on a person exactly as gated intents do.
            urgent: counts.gatedOffers > 0,
          },
        ],
      },
      {
        heading: "Demo",
        items: [{ id: "scenarios", label: "Scenarios", icon: FlaskConical, count: null }],
      },
    ],
    [counts, events.length],
  );

  const panes: Record<ViewId, ReactNode> = {
    overview: (
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
          <AgentConsole onActivity={bump} refreshKey={refreshKey} />
          <OfferStudio onActivity={bump} />
          <IntentsPanel refreshKey={refreshKey} />
          <ScenarioRunner onActivity={bump} />
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-5">
          <RevenueStrip refreshKey={refreshKey} />
          <MandatesPanel refreshKey={refreshKey} />
          <CampaignPanel refreshKey={refreshKey} onActivity={bump} />
          <AuditFeed events={events} connection={connection} />
        </div>
      </div>
    ),
    agent: (
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 lg:col-span-7">
          <AgentConsole onActivity={bump} refreshKey={refreshKey} className="min-h-[40rem]" />
        </div>
        <div className="flex min-w-0 lg:col-span-5">
          <MandatesPanel refreshKey={refreshKey} className="min-h-[40rem]" />
        </div>
      </div>
    ),
    intents: (
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 lg:col-span-7">
          <IntentsPanel refreshKey={refreshKey} className="min-h-[44rem]" />
        </div>
        <div className="flex min-w-0 lg:col-span-5">
          <AuditFeed events={events} connection={connection} className="min-h-[44rem]" />
        </div>
      </div>
    ),
    mandates: (
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 lg:col-span-7">
          <MandatesPanel refreshKey={refreshKey} className="min-h-[40rem]" />
        </div>
        <div className="flex min-w-0 lg:col-span-5">
          <AgentConsole onActivity={bump} refreshKey={refreshKey} className="min-h-[40rem]" />
        </div>
      </div>
    ),
    growth: (
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
          <OfferStudio onActivity={bump} />
          <CampaignPanel refreshKey={refreshKey} onActivity={bump} />
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-5">
          <RevenueStrip refreshKey={refreshKey} />
          <AuditFeed events={events} connection={connection} />
        </div>
      </div>
    ),
    offers: (
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 lg:col-span-7">
          <OfferLedger refreshKey={refreshKey} onActivity={bump} className="min-h-[44rem]" />
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-5">
          <RevenueStrip refreshKey={refreshKey} />
          <CampaignPanel refreshKey={refreshKey} onActivity={bump} />
        </div>
      </div>
    ),
    audit: (
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 lg:col-span-8">
          <AuditFeed events={events} connection={connection} className="min-h-[46rem]" />
        </div>
        <div className="flex min-w-0 lg:col-span-4">
          <IntentsPanel refreshKey={refreshKey} className="min-h-[46rem]" />
        </div>
      </div>
    ),
    scenarios: (
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 lg:col-span-7">
          <ScenarioRunner onActivity={bump} className="min-h-[44rem]" />
        </div>
        <div className="flex min-w-0 lg:col-span-5">
          <AuditFeed events={events} connection={connection} className="min-h-[44rem]" />
        </div>
      </div>
    ),
  };

  return (
    <div className="relative min-h-dvh p-4 lg:flex lg:gap-6 lg:p-6 bg-[#0e0e0f] text-[#e5e2e3]">
      {/*
       * The control room runs the field cheap on purpose.
       *
       * This screen carries roughly twice its own viewport in `backdrop-filter`
       * area — the rail, the header, and every panel. Blurred backdrops have to
       * be recomputed whenever what is behind them repaints, so an uncapped
       * shader makes the compositor re-blur two screens sixty times a second for
       * a field that is 40% opaque behind a vignette.
       *
       * Capping it at 20fps is invisible at this drift speed and buys back two
       * thirds of that. 1x pixels and two octaves cut the shader's own cost on
       * top. No pointer tracking either: nothing on this screen reacts to it.
       */}
      <MoltenBackground
        opacity={0.4}
        speed={0.12}
        scale={5}
        detail={2}
        dpr={1}
        fps={20}
        mouseStrength={0}
      />

      {/* The rail holds still while the page scrolls past it. */}
      <div className="mb-4 lg:sticky lg:top-6 lg:mb-0 lg:h-[calc(100dvh-3rem)]">
        <DashboardNav
          groups={groups}
          active={view}
          connection={connection}
          merchant="Kirana Labs"
          onSelect={setView}
          onReset={reset}
          resetting={resetting}
          resetDisabled={resetting || offline}
        />
      </div>

      <main className="min-w-0 flex-1">
        <header className="rounded-2xl border border-[#ffb77b]/20 bg-[#141416]/90 px-6 py-5 shadow-xl backdrop-blur-xl transition-all">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] font-medium tracking-[0.2em] text-[#ffb77b] uppercase">
                <Today />
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
                  <LiveDot
                    tone={
                      connection === "live" ? "pass" : connection === "offline" ? "fail" : "gate"
                    }
                    active={connection === "live"}
                  />
                  {offline ? "API unreachable" : connection === "live" ? "streaming" : connection}
                </span>
              </p>
              <h1 className="font-serif mt-2.5 text-[clamp(1.75rem,3.2vw,2.6rem)] leading-[1.02] font-normal italic text-[#f5f3f0] tracking-[-0.02em]">
                {meta.title}{" "}
                <span className="bg-gradient-to-r from-[#ffd0a8] via-[#ffb77b] to-[#b16d2e] bg-clip-text text-transparent">
                  {meta.accent}
                </span>
              </h1>
              <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-[#c7b0a6]">
                {meta.blurb}
              </p>
            </div>

            {/* Chain integrity is a verdict on the whole room, so it anchors the
                top-right corner rather than riding above the configuration. */}
            <ChainBadge health={health} offline={offline} />
          </div>

          <RunConfig health={health} offline={offline} />
        </header>

        <div className="mt-6">
          <LiveMetrics events={events} connection={connection} />
        </div>

        <div className="mt-6 pb-6">{panes[view]}</div>
      </main>
    </div>
  );
}

/**
 * Today's date, in the reader's own locale and timezone.
 *
 * Read through a store rather than set in an effect: the server has no business
 * guessing either, so its snapshot is empty and the client fills it in on the
 * first render after hydration. `getSnapshot` returns a fresh string each call
 * but the same *value*, which is what React compares.
 */
const NEVER_CHANGES = () => () => {};

function Today() {
  const label = useSyncExternalStore(
    NEVER_CHANGES,
    () =>
      new Date()
        .toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
        .toUpperCase(),
    () => "",
  );
  return <>{label}</>;
}

/**
 * Whether the audit chain still verifies — the one badge that describes the room
 * as a whole rather than one panel, so it sits in the header's top-right corner.
 */
function ChainBadge({ health, offline }: { health: Health | null; offline: boolean }) {
  if (offline) {
    return (
      <span className="flex shrink-0 items-center gap-2 rounded-xl border border-fail-500/30 bg-fail-bg/60 px-3 py-2 text-[12px] font-medium text-fail-500">
        <CircleAlert size={13} />
        <span className="hidden sm:inline">API unreachable at {API_BASE}</span>
        <span className="sm:hidden">offline</span>
      </span>
    );
  }
  if (!health) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      {health.warnings.map((warning) => (
        <Badge key={warning} tone="gate" title={warning}>
          dev secret
        </Badge>
      ))}
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold",
          health.audit_chain_valid
            ? "border-pass-500/30 bg-pass-bg/60 text-pass-500"
            : "border-fail-500/30 bg-fail-bg/60 text-fail-500",
        )}
        title={`${health.audit_events} events recorded since the last reset`}
      >
        <ShieldCheck size={13} />
        {health.audit_chain_valid ? "chain intact" : "chain broken"}
      </span>
    </div>
  );
}

/** How this run is configured, on its own rule-separated row under the title. */
function RunConfig({ health, offline }: { health: Health | null; offline: boolean }) {
  if (offline || !health) return null;

  return (
    <div className="mt-5 border-t border-white/[0.07] pt-4">
      <div className="flex w-fit max-w-full flex-wrap items-stretch divide-x divide-white/[0.07] overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02]">
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
    </div>
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
