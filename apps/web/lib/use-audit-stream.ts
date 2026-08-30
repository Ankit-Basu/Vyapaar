"use client";

import type { AuditEvent } from "@vyapaar/shared-types";
import { useEffect, useRef, useState } from "react";

import { API_BASE } from "@/lib/api";

export type Connection = "connecting" | "live" | "offline";

/** Rows kept in memory. Past this the feed is scrolled, not read. */
const WINDOW = 250;

/**
 * The single SSE subscription for the control room.
 *
 * It lives here rather than inside the feed because two things now read the
 * stream — the feed itself and the metrics strip above it — and two
 * `EventSource`s against the same endpoint would mean two server-side
 * subscribers replaying the same history twice.
 */
export function useAuditStream(replay = 200) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [connection, setConnection] = useState<Connection>("connecting");
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/audit/stream?replay=${replay}`);

    source.addEventListener("open", () => setConnection("live"));
    source.addEventListener("error", () => setConnection("offline"));
    source.addEventListener("ready", () => setConnection("live"));

    source.addEventListener("audit", (message) => {
      const event = JSON.parse((message as MessageEvent).data) as AuditEvent;
      // The replay and the live tail can overlap; seq is the dedupe key.
      if (seen.current.has(event.seq)) return;
      seen.current.add(event.seq);
      setEvents((current) => [event, ...current].slice(0, WINDOW));
    });

    return () => source.close();
  }, [replay]);

  return { events, connection };
}
