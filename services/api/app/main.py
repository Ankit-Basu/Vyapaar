"""AgentMandi API -- the agent commerce layer in front of a Razorpay merchant.

Boot order matters: schema first, then bind the SSE broadcaster to the running
event loop (audit rows are written from worker threads and have to hop back onto
it), then seed the catalog if this is a fresh database.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .audit.broadcaster import broadcaster
from .agent.router import router as agent_router
from .audit.router import router as audit_router
from .catalog import store as catalog
from .catalog.router import router as catalog_router
from .config import get_settings
from .db import init_db
from .demo.router import router as demo_router
from .intents.router import router as intents_router
from .mandate.router import router as mandate_router
from .payments.gateway import get_gateway
from .payments.router import router as payments_router
from .policy.router import router as policy_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)-28s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("agentmandi")

API_VERSION = "0.1.0"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    init_db()
    broadcaster.bind_loop(asyncio.get_running_loop())

    if catalog.product_count() == 0:
        result = catalog.ingest_seed_file()
        log.info("seeded catalog: %s products from %s", result["ingested"], result["source"])

    gateway = get_gateway()
    log.info("merchant   : %s (%s)", settings.merchant_name, settings.merchant_id)
    log.info("payments   : %s", gateway.mode)
    log.info("llm        : %s / %s", settings.effective_llm_provider, settings.effective_llm_model)
    log.info("HITL gate  : INR %.2f", settings.hitl_threshold_paise / 100)
    if settings.using_default_mandate_secret:
        log.warning(
            "MANDATE_JWT_SECRET is the built-in development default. "
            "Set a real secret before exposing this service to anything."
        )
    yield
    log.info("shutting down")


app = FastAPI(
    title="AgentMandi",
    version=API_VERSION,
    lifespan=lifespan,
    summary="An agent commerce layer: discovery, signed mandates, guardrails and payments.",
    description=(
        "Makes an ordinary Razorpay test-mode merchant discoverable and transactable by an "
        "external AI buyer agent. Every money action passes the guardrail engine first and "
        "lands in a hash-chained audit trail."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    catalog_router,
    mandate_router,
    policy_router,
    intents_router,
    payments_router,
    audit_router,
    agent_router,
    demo_router,
):
    app.include_router(router)


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    """Domain errors carry messages meant for an agent to read and act on."""
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/", tags=["meta"], summary="Service description for a visiting agent")
def root() -> dict:
    settings = get_settings()
    return {
        "service": "AgentMandi",
        "version": API_VERSION,
        "description": (
            "Agent commerce layer for a Razorpay test-mode merchant. Discover products, "
            "obtain a signed mandate, raise a purchase intent, clear the guardrails, pay."
        ),
        "merchant": {"id": settings.merchant_id, "name": settings.merchant_name},
        "currency": "INR",
        "money_unit": "integer paise (100 paise = INR 1)",
        "conventions": {
            "catalog_feed": "ACP-style machine-readable feed at GET /catalog/feed",
            "mandate": "AP2-style signed JWT encoding scope, caps and expiry",
            "mcp": "MCP server exposes search_catalog, get_product, create_purchase_intent, confirm_purchase",
        },
        "start_here": {
            "feed": "/catalog/feed",
            "search": "/catalog/search?q=wireless+mouse+under+1500",
            "issue_mandate": "POST /mandate/issue",
            "raise_intent": "POST /intents",
            "guardrails": "/policy/config",
            "audit_trail": "/audit/events",
            "live_stream": "/audit/stream",
            "openapi": "/docs",
        },
    }


@app.get("/health", tags=["meta"], summary="Liveness and configuration report")
def health() -> dict:
    settings = get_settings()
    from .audit import log as audit  # noqa: PLC0415 - keeps import graph shallow at boot

    chain = audit.verify_chain()
    return {
        "status": "ok",
        "version": API_VERSION,
        "environment": settings.environment,
        "catalog_products": catalog.product_count(),
        "payments_mode": get_gateway().mode,
        "razorpay_test_keys_configured": settings.razorpay_configured,
        "llm_provider": settings.effective_llm_provider,
        "llm_model": settings.effective_llm_model,
        "embeddings_backend": settings.embeddings_backend,
        "hitl_threshold_paise": settings.hitl_threshold_paise,
        "audit_events": chain.length,
        "audit_chain_valid": chain.valid,
        "warnings": (
            ["MANDATE_JWT_SECRET is the development default"]
            if settings.using_default_mandate_secret
            else []
        ),
    }
