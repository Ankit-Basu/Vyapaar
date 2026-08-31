"""Runtime configuration for the Vyapaar API.

Every secret comes from the environment. Nothing sensitive is ever hardcoded --
see `.env.example` at the repo root for the full list.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
SERVICE_ROOT = Path(__file__).resolve().parents[1]

def _default_public_base_url() -> str:
    """Where this service is reachable from the outside.

    It matters because the simulated gateway builds its checkout link from it,
    and that link is handed to an agent or opened from the dashboard. Left at the
    localhost default on a host, the deployed API cheerfully returns a URL that
    only resolves on the machine nobody is using.

    `RENDER_EXTERNAL_URL` is injected by Render, so the deployed case is correct
    with no configuration. An explicit `PUBLIC_BASE_URL` still wins, which is
    what other hosts and tunnels set.
    """
    return os.environ.get("RENDER_EXTERNAL_URL") or "http://127.0.0.1:8000"


PaymentsMode = Literal["auto", "live", "simulated"]
EmbeddingsBackend = Literal["hashing", "sentence-transformers"]
LLMProvider = Literal["auto", "gemini", "groq", "ollama", "offline"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", SERVICE_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- service ---
    environment: str = Field(default="local", alias="VYAPAAR_ENV")
    api_host: str = Field(default="127.0.0.1", alias="API_HOST")
    api_port: int = Field(default=8000, alias="API_PORT")
    public_base_url: str = Field(
        default_factory=_default_public_base_url, alias="PUBLIC_BASE_URL"
    )
    web_base_url: str = Field(default="http://localhost:3000", alias="WEB_BASE_URL")
    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")

    # --- persistence ---
    database_path: str = Field(default=str(REPO_ROOT / "data" / "vyapaar.db"), alias="DATABASE_PATH")
    seed_products_path: str = Field(default=str(REPO_ROOT / "seed" / "products.json"), alias="SEED_PRODUCTS_PATH")
    embeddings_backend: EmbeddingsBackend = Field(default="hashing", alias="EMBEDDINGS_BACKEND")

    # --- merchant identity ---
    merchant_id: str = Field(default="merch_kirana_labs", alias="MERCHANT_ID")
    merchant_name: str = Field(default="Kirana Labs Pvt Ltd", alias="MERCHANT_NAME")

    # --- signed mandates (AP2-style consent tokens) ---
    mandate_jwt_secret: str = Field(default="dev-only-insecure-mandate-secret-change-me", alias="MANDATE_JWT_SECRET")
    mandate_jwt_algorithm: str = Field(default="HS256", alias="MANDATE_JWT_ALG")
    mandate_issuer: str = Field(default="vyapaar.mandate.v1", alias="MANDATE_ISSUER")
    mandate_max_ttl_hours: int = Field(default=720, alias="MANDATE_MAX_TTL_HOURS")

    # --- guardrails ---
    hitl_threshold_paise: int = Field(default=500_000, alias="HITL_THRESHOLD_PAISE")
    max_qty_per_intent: int = Field(default=10, alias="MAX_QTY_PER_INTENT")
    intent_reservation_ttl_seconds: int = Field(default=900, alias="INTENT_RESERVATION_TTL_SECONDS")

    # --- payments (Razorpay TEST MODE ONLY) ---
    payments_mode: PaymentsMode = Field(default="auto", alias="PAYMENTS_MODE")
    razorpay_key_id: str = Field(default="", alias="RAZORPAY_KEY_ID")
    razorpay_key_secret: str = Field(default="", alias="RAZORPAY_KEY_SECRET")
    razorpay_webhook_secret: str = Field(default="dev-only-insecure-webhook-secret", alias="RAZORPAY_WEBHOOK_SECRET")

    # --- agent LLM (provider agnostic; every provider has a free tier) ---
    llm_provider: LLMProvider = Field(default="auto", alias="LLM_PROVIDER")
    llm_model: str = Field(default="", alias="LLM_MODEL")
    llm_timeout_seconds: float = Field(default=30.0, alias="LLM_TIMEOUT_SECONDS")
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    # Accepts one key or a comma-separated pool. See `groq_api_keys`.
    groq_api_key: str = Field(default="", alias="GROQ_API_KEY")
    ollama_base_url: str = Field(default="http://127.0.0.1:11434", alias="OLLAMA_BASE_URL")

    @field_validator("razorpay_key_id")
    @classmethod
    def _test_keys_only(cls, v: str) -> str:
        """Hard stop on live Razorpay credentials. This project never touches real money."""
        if v and not v.startswith("rzp_test_"):
            raise ValueError(
                "Vyapaar refuses non-test Razorpay keys. RAZORPAY_KEY_ID must start with 'rzp_test_'."
            )
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def groq_api_keys(self) -> list[str]:
        """Groq keys as a pool.

        A single key is just a pool of one, so `GROQ_API_KEY=abc` keeps working.
        Several comma-separated keys let the client rotate away from whichever
        one is rate-limited -- Groq's free tier is generous per key but easy to
        exhaust during a demo that runs seven scenarios back to back.
        """
        return [key.strip() for key in self.groq_api_key.split(",") if key.strip()]

    @property
    def razorpay_configured(self) -> bool:
        return bool(self.razorpay_key_id and self.razorpay_key_secret)

    @property
    def effective_payments_mode(self) -> Literal["live", "simulated"]:
        """`auto` uses real Razorpay test mode when keys exist, otherwise the local simulator.

        The simulator mints rzp_test-shaped identifiers and signs its webhooks with the same
        secret as Razorpay would, so the signature-verification path is exercised either way.
        """
        if self.payments_mode == "live":
            return "live"
        if self.payments_mode == "simulated":
            return "simulated"
        return "live" if self.razorpay_configured else "simulated"

    @property
    def effective_llm_provider(self) -> Literal["gemini", "groq", "ollama", "offline"]:
        """`auto` picks the first provider with credentials, else a deterministic offline planner."""
        if self.llm_provider != "auto":
            return self.llm_provider
        if self.gemini_api_key:
            return "gemini"
        if self.groq_api_keys:
            return "groq"
        return "offline"

    @property
    def effective_llm_model(self) -> str:
        if self.llm_model:
            return self.llm_model
        return {
            "gemini": "gemini-2.0-flash",
            # Groq retired llama-3.3-70b-versatile; this is the strongest
            # chat model the free tier currently serves.
            "groq": "openai/gpt-oss-120b",
            "ollama": "llama3.2",
            "offline": "deterministic-planner",
        }[self.effective_llm_provider]

    @property
    def using_default_mandate_secret(self) -> bool:
        return self.mandate_jwt_secret.startswith("dev-only-insecure")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
