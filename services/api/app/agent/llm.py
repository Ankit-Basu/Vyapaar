"""Provider-agnostic LLM wrapper.

Gemini, Groq and Ollama all have free tiers and all speak different tool-calling
dialects. Rather than maintain three schema translations, every provider is asked
for a single JSON object describing its next action. That works identically
across hosted and local models, is cheap to validate, and keeps the planner
honest -- a malformed reply is caught and rejected rather than half-executed.

When no provider is configured the wrapper reports itself unavailable and the
buyer agent falls back to its deterministic planner, so the demo runs end to end
on a machine with no API keys at all.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Protocol

import httpx

from ..config import get_settings

log = logging.getLogger("vyapaar.agent.llm")


class LLMUnavailable(Exception):
    """No usable provider, or the provider failed. Callers fall back rather than crash."""


class LLMClient(Protocol):
    provider: str
    model: str

    def complete_json(self, *, system: str, user: str) -> dict[str, Any]: ...


def _extract_json(text: str) -> dict[str, Any]:
    """Models sometimes wrap JSON in prose or a fenced block. Recover the object."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1] if text.count("```") >= 2 else text.strip("`")
        if text.lstrip().lower().startswith("json"):
            text = text.lstrip()[4:]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError as exc:
                raise LLMUnavailable(f"Model returned unparseable JSON: {exc}") from exc
        raise LLMUnavailable("Model returned no JSON object") from None


class GeminiClient:
    provider = "gemini"

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.gemini_api_key:
            raise LLMUnavailable("GEMINI_API_KEY is not set")
        self.model = settings.effective_llm_model
        self._key = settings.gemini_api_key
        self._timeout = settings.llm_timeout_seconds

    def complete_json(self, *, system: str, user: str) -> dict[str, Any]:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent"
        )
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
        }
        try:
            response = httpx.post(
                url, params={"key": self._key}, json=body, timeout=self._timeout
            )
            response.raise_for_status()
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
        except (httpx.HTTPError, KeyError, IndexError) as exc:
            raise LLMUnavailable(f"Gemini call failed: {exc}") from exc
        return _extract_json(text)


class _KeyPool:
    """Round-robin over several API keys, skipping any that are cooling off.

    Groq's free tier is generous per key but easy to exhaust: a "Run all" of the
    seven demo scenarios fires a burst of planner calls, and one 429 mid-demo
    drops the agent back to the deterministic planner in front of an audience.
    Spreading the burst over several keys and parking a rate-limited one for as
    long as the server asks avoids that without any retry storm.
    """

    #: Fallback park time when the response carries no `retry-after`.
    DEFAULT_COOLDOWN = 45.0

    def __init__(self, keys: list[str]) -> None:
        self._keys = keys
        self._cool_until = [0.0] * len(keys)
        self._next = 0
        self._lock = threading.Lock()

    def __len__(self) -> int:
        return len(self._keys)

    def order(self) -> list[int]:
        """Indices to try for one call: warm keys first, then any that are cooling.

        Rotating the starting point rather than always beginning at zero is what
        actually spreads load -- otherwise the first key absorbs every request
        and the others only ever see traffic after it has already been limited.
        """
        now = time.monotonic()
        with self._lock:
            start = self._next
            self._next = (self._next + 1) % len(self._keys)
            cool = list(self._cool_until)
        rotated = [(start + offset) % len(self._keys) for offset in range(len(self._keys))]
        warm = [i for i in rotated if cool[i] <= now]
        # Cooling keys still get tried last: a stale cooldown is better than no answer.
        return warm + [i for i in rotated if cool[i] > now]

    def key(self, index: int) -> str:
        return self._keys[index]

    def penalise(self, index: int, seconds: float | None) -> None:
        with self._lock:
            self._cool_until[index] = time.monotonic() + (seconds or self.DEFAULT_COOLDOWN)

    def available(self) -> int:
        now = time.monotonic()
        with self._lock:
            return sum(1 for until in self._cool_until if until <= now)


def _retry_after_seconds(response: httpx.Response) -> float | None:
    """Groq reports its reset window; honour it rather than guessing."""
    for header in ("retry-after", "x-ratelimit-reset-requests", "x-ratelimit-reset-tokens"):
        raw = response.headers.get(header)
        if not raw:
            continue
        try:
            return float(raw.rstrip("s"))
        except ValueError:
            continue
    return None


class GroqClient:
    provider = "groq"

    def __init__(self) -> None:
        settings = get_settings()
        keys = settings.groq_api_keys
        if not keys:
            raise LLMUnavailable("GROQ_API_KEY is not set")
        self.model = settings.effective_llm_model
        self._pool = _KeyPool(keys)
        self._timeout = settings.llm_timeout_seconds

    @property
    def key_count(self) -> int:
        return len(self._pool)

    def complete_json(self, *, system: str, user: str) -> dict[str, Any]:
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.2,
        }

        last_error: str = "no key was tried"
        for index in self._pool.order():
            try:
                response = httpx.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {self._pool.key(index)}"},
                    json=body,
                    timeout=self._timeout,
                )
            except httpx.HTTPError as exc:
                last_error = f"transport error: {exc}"
                self._pool.penalise(index, 10.0)
                continue

            if response.status_code == 429:
                wait = _retry_after_seconds(response)
                # Never log the key itself, only which slot it occupies.
                log.info("groq key %d rate-limited; rotating (reset in %ss)", index, wait)
                self._pool.penalise(index, wait)
                last_error = "rate limited"
                continue

            if response.status_code in (401, 403):
                # A bad key never recovers on its own, so park it for a long time
                # rather than burning a request on it every call.
                log.warning("groq key %d rejected (%d); parking it", index, response.status_code)
                self._pool.penalise(index, 3600.0)
                last_error = f"key rejected ({response.status_code})"
                continue

            if response.status_code >= 500:
                self._pool.penalise(index, 15.0)
                last_error = f"groq {response.status_code}"
                continue

            if response.status_code >= 400:
                # A malformed request fails identically on every key, so rotating
                # would just multiply one bug into N wasted calls.
                raise LLMUnavailable(f"Groq rejected the request ({response.status_code})")

            try:
                return _extract_json(response.json()["choices"][0]["message"]["content"])
            except (KeyError, IndexError, ValueError) as exc:
                raise LLMUnavailable(f"Groq returned an unusable body: {exc}") from exc

        raise LLMUnavailable(f"All {len(self._pool)} Groq key(s) failed: {last_error}")


class OllamaClient:
    provider = "ollama"

    def __init__(self) -> None:
        settings = get_settings()
        self.model = settings.effective_llm_model
        self._base = settings.ollama_base_url.rstrip("/")
        self._timeout = max(settings.llm_timeout_seconds, 60.0)

    def complete_json(self, *, system: str, user: str) -> dict[str, Any]:
        try:
            response = httpx.post(
                f"{self._base}/api/chat",
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "format": "json",
                    "stream": False,
                    "options": {"temperature": 0.2},
                },
                timeout=self._timeout,
            )
            response.raise_for_status()
            text = response.json()["message"]["content"]
        except (httpx.HTTPError, KeyError) as exc:
            raise LLMUnavailable(f"Ollama call failed: {exc}") from exc
        return _extract_json(text)


def get_llm() -> LLMClient | None:
    """Return a client for the configured provider, or None to run deterministically."""
    provider = get_settings().effective_llm_provider
    try:
        if provider == "gemini":
            return GeminiClient()
        if provider == "groq":
            return GroqClient()
        if provider == "ollama":
            return OllamaClient()
    except LLMUnavailable as exc:
        log.warning("LLM provider %s unavailable (%s); using the deterministic planner", provider, exc)
        return None
    return None


def describe_llm() -> dict[str, Any]:
    settings = get_settings()
    provider = settings.effective_llm_provider
    return {
        "provider": provider,
        "model": settings.effective_llm_model,
        "mode": "llm" if provider != "offline" else "deterministic",
        "note": (
            "No LLM key configured; the buyer agent plans with deterministic rules so the "
            "demo is reproducible offline. Set GEMINI_API_KEY or GROQ_API_KEY to use a model."
            if provider == "offline"
            else f"Buyer agent reasoning is driven by {provider}."
        ),
        **(
            {"groq_key_pool": len(settings.groq_api_keys)}
            if provider == "groq"
            else {}
        ),
    }
