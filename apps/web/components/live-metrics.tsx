"use client";

import { formatPaise, type AuditEvent } from "@agentmandi/shared-types";
import {
  Activity,
  Gavel,
  Link2,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { Connection } from "@/lib/use-audit-stream";
import {
  CountUp,
  LiveDot,
  Ring,
  SegmentBar,
  Spark,
  TONE_COLOR,
  type Segment,
  type Tone,
} from "@/components/ui";

/** Activity window: 24 buckets of 15 seconds. */
const BUCKETS = 24;
const BUCKET_MS = 15_000;
/** How often the sliding window advances. Cheap: it recomputes 24 integers. */
const SLIDE_MS = 10_000;

type PolicyCheckRow = { id: string; status: string; reason: string };

/**
 * Everything on this strip is derived from the audit stream the feed is already
 * subscribed to — no extra polling, and no counter the server would have to
 * maintain. The trade is that the numbers describe the events currently in the
 * window rather than all of history, which is why the strip says so.
 */
export function LiveMetrics({
  events = [],
  connection = "closed",
}: {
  events?: AuditEvent[];
  connection?: Connection;
  refreshKey?: number;
}) {
  // Advances the activity window even when nothing new arrives, so a quiet
  // minute visibly decays instead of freezing on the last spike.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), SLIDE_MS);
    return () => clearInterval(timer);
  }, []);

  const safeEvents = Array.isArray(events) ? events : [];
  const m = useMemo(() => summarise(safeEvents, now), [safeEvents, now]);

  return (
    <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Tile
        icon={TrendingUp}
        tone="pass"
        label="Settled"
        value={
          <CountUp
            value={m.settledPaise}
            format={(n) => formatPaise(Math.round(n))}
            className="tabular-nums"
          />
        }
        footnote={`${m.paidCount} purchase${m.paidCount === 1 ? "" : "s"} confirmed by webhook`}
      />

      <Tile
        icon={Gavel}
        tone="info"
        label="Decisions"
        value={<CountUp value={m.decisions} className="tabular-nums" />}
        footnote={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <Legend tone="pass" label="auto" count={m.approve} />
            <Legend tone="gate" label="gated" count={m.gate} />
            <Legend tone="fail" label="denied" count={m.deny} />
          </span>
        }
      >
        <SegmentBar className="mt-2" segments={m.decisionSegments} />
      </Tile>

      <Tile
        icon={ShieldCheck}
        tone={m.checkTotal === 0 ? "neutral" : m.failed > 0 ? "gate" : "pass"}
        label="Guardrails"
        value={
          <span className="flex items-center gap-3">
            <Ring
              value={m.checkTotal === 0 ? 0 : m.passed / m.checkTotal}
              tone={m.failed > 0 ? "gate" : "pass"}
              size={38}
              stroke={3.5}
            >
              <span className="font-mono text-[10px] font-semibold text-mute-200">
                {m.checkTotal === 0 ? "—" : `${Math.round((m.passed / m.checkTotal) * 100)}%`}
              </span>
            </Ring>
            <span className="min-w-0">
              <CountUp value={m.checkTotal} className="tabular-nums" />
              <span className="ml-1 text-[11px] font-normal text-mute-500">checks</span>
            </span>
          </span>
        }
        footnote={
          m.checkTotal === 0
            ? "No purchase has been evaluated yet."
            : `${m.passed} passed · ${m.failed} failed · ${m.gatedChecks} gated · ${m.skipped} skipped`
        }
      />

      <Tile
        icon={Activity}
        tone="info"
        label="Activity"
        value={
          <span>
            <CountUp value={m.perMinute} format={(n) => n.toFixed(1)} className="tabular-nums" />
            <span className="ml-1 text-[11px] font-normal text-mute-500">events / min</span>
          </span>
        }
        footnote="Last six minutes."
      >
        <Spark className="mt-1.5" points={m.activity} tone="info" height={22} />
      </Tile>

      <Tile
        icon={Link2}
        tone={connection === "offline" ? "fail" : "info"}
        label="Chain"
        value={
          <span>
            <CountUp value={m.chainLength} className="tabular-nums" />
            <span className="ml-1 text-[11px] font-normal text-mute-500">links in view</span>
          </span>
        }
        footnote={
          <span className="flex items-center gap-1.5">
            <LiveDot
              tone={connection === "live" ? "pass" : connection === "offline" ? "fail" : "gate"}
              active={connection === "live"}
            />
            <span className="truncate font-mono">
              {m.headHash ? `head ${m.headHash.slice(0, 12)}…` : "no events yet"}
            </span>
          </span>
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ parts --- */

function Tile({
  icon: Icon,
  tone,
  label,
  value,
  footnote,
  children,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: ReactNode;
  footnote: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className="glass-surface glass-d2 pane-interactive pane-accent group relative flex flex-col justify-between overflow-hidden rounded-2xl p-4"
      style={{ "--pane-accent-hue": TONE_COLOR[tone] } as CSSProperties}
    >
      {/* The instrument's own light: a slow bloom under the numerals, clipped by
          the tile so the falloff reads as light rather than as a circle. It is
          the only thing on the strip that moves unprompted, which is what makes
          the room look like it is running. Decorative — never announced. */}
      <div
        className="instrument-bloom pointer-events-none absolute -top-8 -right-6 size-28 rounded-full blur-2xl"
        style={{ background: TONE_COLOR[tone] }}
        aria-hidden
      />

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="grid size-5.5 place-items-center rounded-md"
            style={{
              background: `color-mix(in srgb, ${TONE_COLOR[tone]} 18%, transparent)`,
              border: `1px solid color-mix(in srgb, ${TONE_COLOR[tone]} 30%, transparent)`,
            }}
          >
            <Icon size={11} style={{ color: TONE_COLOR[tone] }} />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mute-400">
            {label}
          </span>
        </div>
      </div>

      <div className="relative mt-3 font-mono text-[24px] leading-none font-semibold tracking-[-0.02em] text-mute-100 tabular-nums">
        {value}
      </div>

      {children}

      <div className="relative mt-2.5 truncate text-[11px] leading-tight text-mute-500">
        {footnote}
      </div>
    </div>
  );
}

function Legend({ tone, label, count }: { tone: Tone; label: string; count: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1", count === 0 && "opacity-40")}>
      <span
        className="inline-block size-1.5 rounded-full"
        style={{ background: TONE_COLOR[tone] }}
      />
      {count} {label}
    </span>
  );
}

/* ------------------------------------------------------------- derivation --- */

function summarise(events: AuditEvent[] = [], now: number) {
  let settledPaise = 0;
  let paidCount = 0;
  let approve = 0;
  let gate = 0;
  let deny = 0;
  let passed = 0;
  let failed = 0;
  let gatedChecks = 0;
  let skipped = 0;

  const activity = new Array<number>(BUCKETS).fill(0);
  const windowStart = now - BUCKETS * BUCKET_MS;

  for (const event of events) {
    if (event.event_type === "intent.paid") {
      settledPaise += event.amount_paise ?? 0;
      paidCount += 1;
    }

    if (event.event_type === "policy.decision") {
      if (event.decision === "auto_approve") approve += 1;
      else if (event.decision === "gate_for_human") gate += 1;
      else if (event.decision === "deny") deny += 1;

      const checks = event.payload?.checks;
      if (Array.isArray(checks)) {
        for (const check of checks as PolicyCheckRow[]) {
          if (check.status === "pass") passed += 1;
          else if (check.status === "fail") failed += 1;
          else if (check.status === "gate") gatedChecks += 1;
          else if (check.status === "skipped") skipped += 1;
        }
      }
    }

    const at = Date.parse(event.ts);
    if (Number.isFinite(at) && at >= windowStart && at <= now) {
      const bucket = Math.min(BUCKETS - 1, Math.floor((at - windowStart) / BUCKET_MS));
      activity[bucket] += 1;
    }
  }

  const inWindow = activity.reduce((sum, n) => sum + n, 0);
  const decisions = approve + gate + deny;

  const decisionSegments: Segment[] = [
    { value: approve, tone: "pass", label: "auto-approved" },
    { value: gate, tone: "gate", label: "gated for a human" },
    { value: deny, tone: "fail", label: "denied" },
  ];

  return {
    settledPaise,
    paidCount,
    approve,
    gate,
    deny,
    decisions,
    decisionSegments,
    passed,
    failed,
    gatedChecks,
    skipped,
    checkTotal: passed + failed + gatedChecks + skipped,
    activity,
    perMinute: (inWindow / ((BUCKETS * BUCKET_MS) / 60_000)) || 0,
    chainLength: events.length,
    headHash: events[0]?.hash ?? null,
  };
}
