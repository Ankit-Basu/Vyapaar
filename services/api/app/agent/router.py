"""Buyer agent endpoints -- the conversational shopping surface.

The agent runs in-process here for the demo, but it has no privileged path: it
calls the same catalog, intent and payment services an external MCP client would,
and the guardrails treat it with exactly as much suspicion.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..mandate.service import MandateError
from ..models import Base
from ..payments.service import PaymentError
from . import buyer
from .llm import describe_llm

router = APIRouter(prefix="/agent", tags=["agent"])


class AgentRunRequest(Base):
    goal: str
    mandate_token: str
    auto_pay: bool = True


@router.get("/info", summary="Which planner is driving the agent")
def agent_info() -> dict:
    """Reports the active LLM provider, or that the deterministic planner is in use."""
    return {
        **describe_llm(),
        "tools": [
            "search_catalog",
            "get_product",
            "create_purchase_intent",
            "confirm_purchase",
        ],
        "guarantee": (
            "The agent cannot move money directly. Every purchase goes through "
            "POST /intents and only proceeds on an auto_approve decision or a human approval."
        ),
    }


@router.post("/run", response_model=buyer.AgentRunResult, summary="Give the agent a goal")
def run_agent(request: AgentRunRequest) -> buyer.AgentRunResult:
    """Search, choose, raise an intent, clear the guardrails, pay.

    Set `auto_pay=false` to stop at the payment link instead of settling it, which
    is what the declined-card scenario needs.
    """
    try:
        return buyer.run_goal(
            goal=request.goal, mandate_token=request.mandate_token, auto_pay=request.auto_pay
        )
    except MandateError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except PaymentError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
