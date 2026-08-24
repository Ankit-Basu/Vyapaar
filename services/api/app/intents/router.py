"""Purchase intent endpoints -- the agent-facing transaction surface."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..mandate.service import MandateError
from ..models import (
    ConfirmPurchaseRequest,
    ConfirmPurchaseResponse,
    Decision,
    PurchaseIntent,
    PurchaseIntentRequest,
    PurchaseIntentResponse,
)
from ..payments import service as payments
from . import service

router = APIRouter(prefix="/intents", tags=["intents"])


@router.post("", response_model=PurchaseIntentResponse, summary="Raise a purchase intent")
def create_intent(request: PurchaseIntentRequest) -> PurchaseIntentResponse:
    """Runs every guardrail and returns an explainable decision.

    No money moves here. The response says whether the agent may proceed, must
    wait for a human, or has been refused -- and exactly why.
    """
    try:
        return service.create_intent(request)
    except service.IntentError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/confirm", response_model=ConfirmPurchaseResponse, summary="Pay for an approved intent")
def confirm_purchase(request: ConfirmPurchaseRequest) -> ConfirmPurchaseResponse:
    """Opens a Razorpay order and payment link. Rejects anything not APPROVED."""
    try:
        return payments.start_checkout(
            intent_id=request.intent_id, mandate_token=request.mandate_token
        )
    except MandateError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except payments.PaymentError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("", response_model=list[PurchaseIntent], summary="List intents")
def list_intents(
    limit: int = Query(default=50, ge=1, le=200), status: str | None = None
) -> list[PurchaseIntent]:
    return service.list_intents(limit=limit, status=status)


@router.get("/{intent_id}", response_model=PurchaseIntent, summary="One intent")
def get_intent(intent_id: str) -> PurchaseIntent:
    intent = service.get_intent(intent_id)
    if intent is None:
        raise HTTPException(status_code=404, detail=f"No intent with id {intent_id}")
    return intent


@router.get("/{intent_id}/decision", response_model=Decision, summary="The guardrail decision")
def get_intent_decision(intent_id: str) -> Decision:
    """Every check, in order, with its reason. This is the explainability endpoint."""
    decision = service.get_decision(intent_id)
    if decision is None:
        raise HTTPException(status_code=404, detail=f"No decision recorded for {intent_id}")
    return decision
