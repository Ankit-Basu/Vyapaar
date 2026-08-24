"""Fan-out of audit events to every connected dashboard over Server-Sent Events.

Audit rows are written from FastAPI's sync threadpool, but subscribers live on the
asyncio loop. `publish()` therefore hops threads with `call_soon_threadsafe`
rather than touching an `asyncio.Queue` from the wrong thread.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any

log = logging.getLogger("agentmandi.audit.sse")

_MAX_QUEUE = 512


class AuditBroadcaster:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Called once from the app lifespan so worker threads know where to post."""
        self._loop = loop

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=_MAX_QUEUE)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(queue)

    def publish(self, event: dict[str, Any]) -> None:
        """Push an event to every live subscriber. Safe to call from any thread."""
        if not self._subscribers:
            return
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        for queue in list(self._subscribers):
            try:
                loop.call_soon_threadsafe(self._offer, queue, event)
            except RuntimeError:  # pragma: no cover - loop shutting down
                log.debug("dropped audit event, loop unavailable")

    @staticmethod
    def _offer(queue: asyncio.Queue[dict[str, Any]], event: dict[str, Any]) -> None:
        """Never block the loop: a dashboard that stalls loses its oldest event, not ours."""
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            with contextlib.suppress(asyncio.QueueEmpty):
                queue.get_nowait()
            with contextlib.suppress(asyncio.QueueFull):
                queue.put_nowait(event)


broadcaster = AuditBroadcaster()
