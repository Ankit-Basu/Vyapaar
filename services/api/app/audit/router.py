"""Audit endpoints: the trail, its integrity proof, and the live SSE stream."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from ..models import AuditChainVerification, AuditEvent
from . import log as audit
from .broadcaster import broadcaster

logger = logging.getLogger("agentmandi.audit.router")
router = APIRouter(prefix="/audit", tags=["audit"])

HEARTBEAT_SECONDS = 15.0


@router.get("/events", response_model=list[AuditEvent], summary="Audit trail, newest first")
def list_events(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    intent_id: str | None = None,
    mandate_id: str | None = None,
    since_seq: int | None = None,
) -> list[AuditEvent]:
    return audit.list_events(
        limit=limit, offset=offset, intent_id=intent_id, mandate_id=mandate_id, since_seq=since_seq
    )


@router.get("/verify", response_model=AuditChainVerification, summary="Verify the hash chain")
def verify_chain() -> AuditChainVerification:
    """Recompute every hash from genesis.

    A tampered row is reported with the exact sequence number where the chain
    first diverges. (SQLite triggers also block UPDATE and DELETE on this table,
    so producing a break requires going around the application entirely.)
    """
    return audit.verify_chain()


@router.get("/stats", summary="Counters for the dashboard header")
def stats() -> dict:
    verification = audit.verify_chain()
    return {
        "total_events": audit.count_events(),
        "chain_valid": verification.valid,
        "head_hash": verification.head_hash,
        "live_subscribers": broadcaster.subscriber_count,
    }


@router.get("/stream", summary="Live audit stream (Server-Sent Events)")
async def stream(
    request: Request, replay: int = Query(default=25, ge=0, le=200)
) -> StreamingResponse:
    """Replays recent history, then streams every new event as it is appended."""
    queue = broadcaster.subscribe()

    async def event_source() -> AsyncIterator[bytes]:
        try:
            # Oldest first, so the dashboard can prepend in a consistent order.
            for event in reversed(audit.list_events(limit=replay)):
                yield _sse(event.seq, "audit", event.model_dump())
            yield _sse(None, "ready", {"replayed": replay})

            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
                except TimeoutError:
                    # Comment frame: keeps proxies and browsers from closing an idle stream.
                    yield b": keepalive\n\n"
                    continue
                yield _sse(event.get("seq"), "audit", event)
        except asyncio.CancelledError:  # pragma: no cover - client vanished
            raise
        finally:
            broadcaster.unsubscribe(queue)

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _sse(event_id: int | None, event_name: str, data: dict) -> bytes:
    lines = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event_name}")
    lines.append(f"data: {json.dumps(data, default=str)}")
    return ("\n".join(lines) + "\n\n").encode("utf-8")
