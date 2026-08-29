"use client";

import { formatPaise, type AuditEvent } from "@agentmandi/shared-types";
import { AlertTriangle, Link2, Radio, ScrollText, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { API_BASE, verifyAuditChain, type AuditChainVerification } from "@/lib/api";
import type { Connection } from "@/lib/use-audit-stream";
import { cn, shortHash, timeAgo } from "@/lib/utils";
import {
  Badge,
  EmptyState,
  Mono,
  Panel,
  TONE_COLOR,
  toneForStatus,
  type Tone,
} from "@/components/ui";

/** Label and colour per event family, so the feed is scannable at a glance. */
const EVENT_STYLE: Record<string, { label: string; tone: Tone }> = {
  "mandate.issued": { label: "mandate", tone: "info" },
  "intent.created": { label: "intent", tone: "neutral" },
  "intent.rejected": { label: "rejected", tone: "fail" },
  "policy.decision": { label: "policy", tone: "info" },
  "policy.gate_approved": { label: "human ok", tone: "pass" },
  "policy.gate_rejected": { label: "human no", tone: "fail" },
  "policy.gate_approved_but_denied": { label: "re-denied", tone: "fail" },
  "payment.initiated": { label: "checkout", tone: "gate" },
  "payment.webhook_verified": { label: "webhook", tone: "info" },
  "payment.webhook_rejected": { label: "bad sig", tone: "fail" },
  "payment.webhook_ignored": { label: "ignored", tone: "skip" },
  "payment.gateway_error": { label: "gateway", tone: "fail" },
  "intent.paid": { label: "paid", tone: "pass" },
  "intent.failed": { label: "failed", tone: "fail" },
  "demo.reset": { label: "reset", tone: "skip" },
};

/** The feed can get long during a demo; these narrow it to one storyline. */
const FILTERS = [
  { id: "all", label: "All", match: () => true },
  { id: "policy", label: "Policy", match: (t: string) => t.startsWith("policy.") },
  { id: "payment", label: "Payments", match: (t: string) => t.startsWith("payment.") },
  { id: "intent", label: "Intents", match: (t: string) => t.startsWith("intent.") },
  { id: "mandate", label: "Mandate", match: (t: string) => t.startsWith("mandate.") },
] as const;

/** Where the chain rail sits, measured from the row's left edge. */
const RAIL_X = 22;

export function AuditFeed({
  events,
  connection,
  className,
}: {
  events: AuditEvent[];
  connection: Connection;
  className?: string;
}) {
  const [chain, setChain] = useState<AuditChainVerification | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");

  // Re-verify the chain whenever the feed grows, so the header badge is honest.
  useEffect(() => {
    let cancelled = false;
    verifyAuditChain()
      .then((result) => !cancelled && setChain(result))
      .catch(() => !cancelled && setChain(null));
    return () => {
      cancelled = true;
    };
  }, [events.length]);

  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const rows = useMemo(
    () => events.filter((event) => active.match(event.event_type)),
    [events, active],
  );

  return (
    <Panel
      title="Audit trail"
      subtitle="Append-only and hash-chained. Streamed live over SSE."
      icon={<ScrollText size={12} />}
      accent="info"
      className={cn("min-h-0", className)}
      bodyClassName="p-0"
      actions={
        <div className="flex items-center gap-2">
          {chain && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                chain.valid ? "bg-pass-bg text-pass-500" : "bg-fail-bg text-fail-500",
              )}
              title={chain.detail}
            >
              {chain.valid ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}
              {chain.valid ? `${chain.length} chained` : `broken at #${chain.broken_at_seq}`}
            </span>
          )}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
              connection === "live" && "bg-pass-bg text-pass-500",
              connection === "connecting" && "bg-gate-bg text-gate-500",
              connection === "offline" && "bg-fail-bg text-fail-500",
            )}
          >
            <Radio size={11} className={connection === "live" ? "animate-pulse-dot" : undefined} />
            {connection}
          </span>
        </div>
      }
      toolbar={FILTERS.map((option) => {
        const count =
          option.id === "all"
            ? events.length
            : events.filter((e) => option.match(e.event_type)).length;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={cn(
              "lift rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all",
              filter === option.id
                ? "bg-brand-500/20 text-brand-300 shadow-sm border border-brand-500/30"
                : "text-mute-400 hover:bg-white/[0.06] hover:text-mute-200",
            )}
          >
            {option.label}
            <span className="ml-1.5 font-mono text-[10px] tabular-nums opacity-60">
              {count}
            </span>
          </button>
        );
      })}
    >
      {rows.length === 0 ? (
        <EmptyState icon={<ScrollText size={16} />}>
          {connection === "offline"
            ? `No stream from ${API_BASE}. Start the API and this reconnects on its own.`
            : events.length === 0
              ? "Waiting for the first event. Run the agent or a scenario to fill this."
              : `Nothing in the ${active.label.toLowerCase()} family yet.`}
        </EmptyState>
      ) : (
        <ol className="relative">
          {/*
           * The chain, drawn once for the whole list rather than per row: a
           * static hairline, plus one travelling highlight while the stream is
           * connected.
           */}
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.08]"
            style={{ left: RAIL_X }}
            aria-hidden
          />
          {connection === "live" && (
            <span
              className="chain-flow pointer-events-none absolute inset-y-0 w-px opacity-80"
              style={{ left: RAIL_X }}
              aria-hidden
            />
          )}

          {rows.map((event, index) => (
            <AuditRow key={event.event_id} event={event} isNewest={index === 0} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function AuditRow({ event, isNewest }: { event: AuditEvent; isNewest: boolean }) {
  const [open, setOpen] = useState(false);
  const style = EVENT_STYLE[event.event_type] ?? { label: "event", tone: "neutral" as const };
  const tone = event.decision ? toneForStatus(event.decision) : style.tone;
  const checks = Array.isArray(event.payload?.checks)
    ? (event.payload.checks as { id: string; status: string; reason: string }[])
    : null;

  return (
    <li className={cn("row-hover relative px-4 py-3 transition-colors hover:bg-white/[0.03]", isNewest && "animate-arrive")}>
      {/* Node in the cryptographic chain */}
      <span
        className="pointer-events-none absolute top-[16px] size-2 rounded-full ring-4 ring-ink-950 shadow-sm"
        style={{ left: RAIL_X - 4, background: TONE_COLOR[tone], boxShadow: `0 0 6px ${TONE_COLOR[tone]}` }}
        aria-hidden
      />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 pl-[28px] text-left"
      >
        <Badge tone={tone} className="mt-0.5 shrink-0">
          {event.decision ?? style.label}
        </Badge>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-snug font-medium text-mute-100">{event.summary}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-mute-400">
            <span className="font-mono text-mute-300 font-semibold">#{event.seq}</span>
            <span>·</span>
            <span className="font-medium text-mute-300">{event.actor}</span>
            <span>·</span>
            <span className="font-mono text-mute-400">{timeAgo(event.ts)}</span>
            {event.amount_paise !== null && (
              <>
                <span>·</span>
                <span className="font-mono font-semibold text-mute-200">{formatPaise(event.amount_paise)}</span>
              </>
            )}
            <span>·</span>
            <span className="inline-flex items-center gap-1 font-mono text-brand-300">
              <Link2 size={10} />
              {shortHash(event.hash, 8)}
            </span>
          </span>
        </span>
      </button>

      <div className="expandable" data-open={open}>
        <div>
          <div className="mt-2 ml-[26px] space-y-2 rounded-lg border border-white/[0.07] bg-white/[0.03] p-3">
            {event.reasons.length > 0 && (
              <ul className="space-y-1">
                {event.reasons.map((reason, i) => (
                  <li key={i} className="text-[12px] leading-relaxed text-mute-300 [overflow-wrap:anywhere]">
                    {reason}
                  </li>
                ))}
              </ul>
            )}
            {checks && (
              <ol className="space-y-1 border-t border-white/[0.07] pt-2">
                {checks.map((check) => (
                  <li key={check.id} className="flex items-start gap-2">
                    <Badge tone={toneForStatus(check.status)} className="mt-px shrink-0">
                      {check.status}
                    </Badge>
                    <span className="text-[12px] leading-relaxed text-mute-400 [overflow-wrap:anywhere]">
                      <span className="font-medium text-mute-300">{check.id}</span> — {check.reason}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <div className="border-t border-white/[0.07] pt-2 text-[11px] leading-relaxed">
              <Mono className="block">prev {shortHash(event.prev_hash, 24)}</Mono>
              <Mono className="block">hash {shortHash(event.hash, 24)}</Mono>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
