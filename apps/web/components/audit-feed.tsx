"use client";

import { formatPaise, type AuditEvent } from "@agentmandi/shared-types";
import { AlertTriangle, Link2, Radio, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { API_BASE, verifyAuditChain, type AuditChainVerification } from "@/lib/api";
import { cn, shortHash, timeAgo } from "@/lib/utils";
import { Badge, EmptyState, Mono, Panel, toneForStatus } from "@/components/ui";

/** Icon and colour per event family, so the feed is scannable at a glance. */
const EVENT_STYLE: Record<string, { label: string; tone: Parameters<typeof Badge>[0]["tone"] }> = {
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

type Connection = "connecting" | "live" | "offline";

export function AuditFeed({ onEvent }: { onEvent?: (event: AuditEvent) => void }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [chain, setChain] = useState<AuditChainVerification | null>(null);
  const seen = useRef<Set<number>>(new Set());
  const onEventRef = useRef(onEvent);

  // Held in a ref, refreshed in an effect: the SSE subscription below must not
  // tear down and reconnect every time the parent passes a new callback
  // identity, but it still needs to call the latest one.
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/audit/stream?replay=40`);

    source.addEventListener("open", () => setConnection("live"));
    source.addEventListener("error", () => setConnection("offline"));
    source.addEventListener("ready", () => setConnection("live"));

    source.addEventListener("audit", (message) => {
      const event = JSON.parse((message as MessageEvent).data) as AuditEvent;
      // The replay and the live tail can overlap; seq is the dedupe key.
      if (seen.current.has(event.seq)) return;
      seen.current.add(event.seq);
      setEvents((current) => [event, ...current].slice(0, 250));
      onEventRef.current?.(event);
    });

    return () => source.close();
  }, []);

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

  return (
    <Panel
      title="Audit trail"
      subtitle="Append-only and hash-chained. Streamed live over SSE."
      className="min-h-0"
      bodyClassName="p-0"
      actions={
        <div className="flex items-center gap-2">
          {chain && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold",
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
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold",
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
    >
      {events.length === 0 ? (
        <EmptyState>
          {connection === "offline"
            ? `No stream from ${API_BASE}. Start the API and this reconnects on its own.`
            : "Waiting for the first event. Run the agent or a scenario to fill this."}
        </EmptyState>
      ) : (
        <ol className="divide-y divide-white/[0.05]">
          {events.map((event, index) => (
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
  const checks = Array.isArray(event.payload?.checks)
    ? (event.payload.checks as { id: string; status: string; reason: string }[])
    : null;

  return (
    <li className={cn("px-4 py-2.5", isNewest && "animate-arrive")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2.5 text-left"
      >
        <span className="mt-0.5 w-8 shrink-0 text-right font-mono text-[10.5px] text-mute-500">
          #{event.seq}
        </span>
        <Badge tone={event.decision ? toneForStatus(event.decision) : style.tone}>
          {event.decision ?? style.label}
        </Badge>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] leading-snug text-mute-100">{event.summary}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-mute-500">
            <span>{event.actor}</span>
            <span>·</span>
            <span>{timeAgo(event.ts)}</span>
            {event.amount_paise !== null && (
              <>
                <span>·</span>
                <span className="font-mono text-mute-400">{formatPaise(event.amount_paise)}</span>
              </>
            )}
            <span>·</span>
            <span className="inline-flex items-center gap-0.5 font-mono">
              <Link2 size={9} />
              {shortHash(event.hash, 8)}
            </span>
          </span>
        </span>
      </button>

      {open && (
        <div className="mt-2 ml-[3.1rem] space-y-2 rounded-lg border border-white/[0.07] bg-white/[0.03] p-3">
          {event.reasons.length > 0 && (
            <ul className="space-y-1">
              {event.reasons.map((reason, i) => (
                <li key={i} className="text-[11.5px] leading-relaxed text-mute-300">
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
                  <span className="text-[11.5px] leading-relaxed text-mute-400">
                    <span className="font-medium text-mute-300">{check.id}</span> — {check.reason}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <div className="border-t border-white/[0.07] pt-2 text-[10.5px] leading-relaxed">
            <Mono className="block">prev {shortHash(event.prev_hash, 24)}</Mono>
            <Mono className="block">hash {shortHash(event.hash, 24)}</Mono>
          </div>
        </div>
      )}
    </li>
  );
}
