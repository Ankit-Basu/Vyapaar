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
from typing import Any, Protocol

import httpx

from ..config import get_settings

log = logging.getLogger("agentmandi.agent.llm")


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


class GroqClient:
    provider = "groq"

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.groq_api_key:
            raise LLMUnavailable("GROQ_API_KEY is not set")
        self.model = settings.effective_llm_model
        self._key = settings.groq_api_key
        self._timeout = settings.llm_timeout_seconds

    def complete_json(self, *, system: str, user: str) -> dict[str, Any]:
        try:
            response = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {self._key}"},
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.2,
                },
                timeout=self._timeout,
            )
            response.raise_for_status()
            text = response.json()["choices"][0]["message"]["content"]
        except (httpx.HTTPError, KeyError, IndexError) as exc:
            raise LLMUnavailable(f"Groq call failed: {exc}") from exc
        return _extract_json(text)


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
    }
