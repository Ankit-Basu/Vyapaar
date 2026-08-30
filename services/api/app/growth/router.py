"""Growth endpoints.

Two audiences, deliberately kept on separate routes:

* `GET /growth/offers` is **agent-facing**. It returns what an offer costs and what
  it changes, and nothing about margin. An agent that presents a mandate gets
  offers fitted to its bounds; one that does not gets them unfitted.
* Everything else is **merchant-facing**: campaign state, unit economics, the
  offer ledger with margins, and the gate a human resolves.

`/growth/economics` is the clearest illustration of the split. It exposes cost
price, and it lives nowhere near `/catalog`.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..mandate import service as mandates
from ..models import (
    Campaign,
    CampaignCreateRequest,
    EvaluatedOffer,
    OfferListResponse,
    RebalanceResult,
    RevenueMetrics,
)
from . import attribution, campaigns, economics, service

router = APIRouter(prefix="/growth", tags=["growth"])


@router.get("/offers", response_model=OfferListResponse, summary="Offers an agent may accept")
def get_offers(
    product_id: str = Query(description="The product the agent is about to buy."),
    mandate_token: str | None = Query(
        default=None,
        description=(
            "Optional. Present a mandate and the merchant fits its offers to what you are "
            "actually allowed to spend, instead of proposing purchases you would have to refuse."
        ),
    ),
) -> OfferListResponse:
    mandate = None
    if mandate_token:
        verification = mandates.verify(mandate_token)
        if not verification.valid or verification.record is None:
            raise HTTPException(status_code=403, detail=verification.reason)
        mandate = verification.record
    try:
        return service.quote_offers(product_id, mandate)
    except service.GrowthError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/offers/{offer_id}/decline", summary="Decline an offer and free its discount")
def decline_offer(offer_id: str, reason: str = "Buyer agent declined the offer.") -> dict:
    try:
        evaluated = service.decline(offer_id, reason)
    except service.GrowthError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"offer_id": offer_id, "status": evaluated.offer.status.value if evaluated else None}


@router.get("/offers/ledger", response_model=list[EvaluatedOffer], summary="Every offer, with margins")
def offer_ledger(
    limit: int = Query(default=50, ge=1, le=200), status: str | None = None
) -> list[EvaluatedOffer]:
    """Merchant view. Includes suppressed offers and the check that refused each one."""
    return service.list_offers(limit=limit, status=status)


@router.get("/offers/{offer_id}", response_model=EvaluatedOffer, summary="One offer and its gauntlet")
def one_offer(offer_id: str) -> EvaluatedOffer:
    evaluated = service.get_offer(offer_id, include_margin=True)
    if evaluated is None:
        raise HTTPException(status_code=404, detail=f"No offer with id {offer_id}")
    return evaluated


@router.post("/offers/{offer_id}/resolve", response_model=EvaluatedOffer, summary="Approve or reject a gated offer")
def resolve_offer_gate(
    offer_id: str,
    approve: bool = Query(default=True),
    resolved_by: str = Query(default="merchant-operator"),
) -> EvaluatedOffer:
    """Approving re-runs every other guardrail against current state first.

    A human waives the depth of the discount. Nobody waives the margin floor.
    """
    try:
        return service.resolve_gate(offer_id, approve, resolved_by)
    except service.GrowthError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/campaigns", response_model=list[Campaign], summary="Campaigns and their discount ledgers")
def list_campaigns() -> list[Campaign]:
    return campaigns.list_campaigns()


@router.post("/campaigns", response_model=Campaign, summary="Open a campaign")
def create_campaign(request: CampaignCreateRequest) -> Campaign:
    return campaigns.create(request)


@router.post("/campaigns/{campaign_id}/status", response_model=Campaign, summary="Pause or resume")
def set_campaign_status(
    campaign_id: str, status: str = Query(pattern="^(ACTIVE|PAUSED|ENDED)$")
) -> Campaign:
    campaign = campaigns.set_status(campaign_id, status)
    if campaign is None:
        raise HTTPException(status_code=404, detail=f"No campaign with id {campaign_id}")
    return campaign


@router.post("/campaigns/rebalance", response_model=RebalanceResult, summary="Re-point the campaign at the right stock")
def rebalance_campaign(campaign_id: str | None = None) -> RebalanceResult:
    """The orchestrator pass. Deterministic, and every move states its observation."""
    try:
        return service.rebalance(campaign_id)
    except service.GrowthError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/metrics", response_model=RevenueMetrics, summary="What the growth agent was worth")
def growth_metrics() -> RevenueMetrics:
    return attribution.revenue_metrics()


@router.get("/economics", summary="Merchant-private unit economics")
def unit_economics() -> dict:
    """Cost price per product. Never served under `/catalog`, never sent to an agent."""
    report = economics.margin_report()
    return {
        "note": (
            "Merchant-private. Cost price is deliberately absent from the Product model and "
            "from every agent-facing route; the margin gauntlet is the only consumer."
        ),
        "products": report,
    }
