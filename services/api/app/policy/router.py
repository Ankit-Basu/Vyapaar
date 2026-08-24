"""Guardrail endpoints: inspect the policy, dry-run it, and resolve human gates."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..catalog import store as catalog
from ..config import get_settings
from ..intents import service as intents
from ..mandate import service as mandates
from ..models import Base, Decision, PurchaseIntentResponse, ResolveGateRequest
from .engine import ORDERED_CHECKS, POLICY_VERSION, EvaluationContext, evaluate

router = APIRouter(prefix="/policy", tags=["policy"])


class PolicySimulationRequest(Base):
    mandate_token: str
    product_id: str
    qty: int = 1


@router.get("/config", summary="The active guardrail configuration")
def policy_config() -> dict:
    """What the engine enforces and in what order. Useful for a judge reading along."""
    settings = get_settings()
    return {
        "policy_version": POLICY_VERSION,
        "hitl_threshold_paise": settings.hitl_threshold_paise,
        "hitl_threshold_inr": settings.hitl_threshold_paise / 100,
        "max_qty_per_intent": settings.max_qty_per_intent,
        "merchant_id": settings.merchant_id,
        "checks": [
            {"order": index + 1, "id": check_id, "name": name}
            for index, (check_id, name, _) in enumerate(ORDERED_CHECKS)
        ],
    }


@router.post("/simulate", response_model=Decision, summary="Dry-run the guardrails")
def simulate(request: PolicySimulationRequest) -> Decision:
    """Evaluate an intent without creating one.

    Nothing is written, no budget is reserved and no audit row is appended -- this
    is purely 'what would the guardrails say?'.
    """
    settings = get_settings()
    verification = mandates.verify(request.mandate_token)
    product = catalog.get_product(request.product_id)
    amount = (product.price_paise * request.qty) if product else 0

    return evaluate(
        EvaluationContext(
            merchant_id=settings.merchant_id,
            product_id=request.product_id,
            qty=request.qty,
            amount_paise=amount,
            hitl_threshold_paise=settings.hitl_threshold_paise,
            max_qty_per_intent=settings.max_qty_per_intent,
            mandate=verification.record if verification.valid else None,
            mandate_invalid_reason=None if verification.valid else verification.reason,
            product=product,
        )
    )


@router.post("/resolve", response_model=PurchaseIntentResponse, summary="Approve or reject a gate")
def resolve_gate(request: ResolveGateRequest) -> PurchaseIntentResponse:
    """The human-in-the-loop control the dashboard posts to.

    Approving re-runs every other guardrail against current state -- a human
    waives the high-value threshold, not stock, category or budget.
    """
    try:
        return intents.resolve_gate(request)
    except intents.IntentError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
