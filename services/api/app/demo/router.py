"""Scripted demo scenarios.

Each scenario is a real run through the real services -- there is no mocking and
no shortcut around the guardrails. The runner only sets the stage (issues a
mandate, adjusts stock) and then lets the buyer agent loose.

`seed/scenarios.json` carries the narrative and what to watch for; this module
carries the mechanics. They are matched by id.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import jwt
from fastapi import APIRouter, HTTPException

from ..agent import buyer
from ..audit import log as audit
from ..catalog import store as catalog
from ..config import REPO_ROOT, get_settings
from ..db import reset_db
from ..growth import attribution
from ..growth import campaigns as growth_campaigns
from ..growth import economics as growth_economics
from ..growth import service as growth
from ..intents import service as intents
from ..mandate import service as mandates
from ..models import (
    Base,
    MandateIssueRequest,
    PurchaseIntentRequest,
    ResolveGateRequest,
)
from ..payments import service as payments

log = logging.getLogger("vyapaar.demo")
router = APIRouter(prefix="/demo", tags=["demo"])

SCENARIOS_PATH = REPO_ROOT / "seed" / "scenarios.json"

# Products the scenarios reach for by id, so a run does not depend on ranking luck.
MOUSE = "prod_elec_001"
SILENT_MOUSE = "prod_elec_002"
HEADPHONES = "prod_elec_005"
KEYBOARD = "prod_elec_003"
WIRELESS_KEYBOARD = "prod_elec_004"
VERTICAL_MOUSE = "prod_elec_011"
YOGA_MAT = "prod_fit_001"
CHAIR = "prod_offc_005"


class ScenarioResult(Base):
    scenario_id: str
    title: str
    proves: str
    outcome: str
    summary: str
    mandate_id: str
    mandate_token: str
    steps: list[dict[str, Any]]
    audit_tail: list[dict[str, Any]]


def _inr(paise: int) -> str:
    return f"INR {paise / 100:,.2f}"


def _load_scenarios() -> dict[str, dict[str, Any]]:
    raw = json.loads(SCENARIOS_PATH.read_text(encoding="utf-8"))
    return {item["id"]: item for item in raw["scenarios"]}


def _issue(spec: dict[str, Any], label: str) -> tuple[str, str]:
    settings = get_settings()
    mandate_spec = spec["mandate"]
    issued = mandates.issue(
        MandateIssueRequest(
            buyer_id=mandate_spec["buyer_id"],
            merchant_id=settings.merchant_id,
            per_txn_cap_paise=mandate_spec["per_txn_cap_paise"],
            total_budget_paise=mandate_spec["total_budget_paise"],
            allowed_categories=mandate_spec["allowed_categories"],
            ttl_hours=mandate_spec.get("ttl_hours", 24),
            label=label,
        )
    )
    return issued.mandate_token, issued.mandate.mandate_id


def _audit_tail(limit: int = 20) -> list[dict[str, Any]]:
    return [event.model_dump() for event in audit.list_events(limit=limit)]


def _run_agent(goal: str, token: str, auto_pay: bool = True) -> dict[str, Any]:
    result = buyer.run_goal(goal=goal, mandate_token=token, auto_pay=auto_pay)
    return result.model_dump()


# --------------------------------------------------------------------------
# Scenario mechanics
# --------------------------------------------------------------------------


def _scenario_happy_path(spec: dict[str, Any]) -> ScenarioResult:
    token, mandate_id = _issue(spec, "demo: happy path")
    catalog.set_stock(MOUSE, 42)
    run = _run_agent("buy a wireless mouse under 1500", token)
    mandate = mandates.get_record(mandate_id)
    return ScenarioResult(
        scenario_id=spec["id"],
        title=spec["title"],
        proves=spec["proves"],
        outcome=run["outcome"],
        summary=(
            f"{run['message']} Mandate now shows {_inr(mandate.spent_paise)} spent of "
            f"{_inr(mandate.total_budget_paise)}."
            if mandate
            else run["message"]
        ),
        mandate_id=mandate_id,
        mandate_token=token,
        steps=[run],
        audit_tail=_audit_tail(),
    )


def _scenario_budget_exceeded(spec: dict[str, Any]) -> ScenarioResult:
    """The headline failure case: denied on budget, then a cheaper purchase clears."""
    token, mandate_id = _issue(spec, "demo: tight budget")
    catalog.set_stock(MOUSE, 42)
    catalog.set_stock(KEYBOARD, 15)
    catalog.set_stock(WIRELESS_KEYBOARD, 28)

    first = _run_agent("buy a wireless mouse under 1500", token)

    # Go at the INR 4,499 keyboard by id. It clears the INR 5,000 per-transaction
    # cap, so the *budget* check is what refuses it -- which is the point.
    over_budget = intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token,
            product_id=KEYBOARD,
            qty=1,
            agent_rationale="Best-reviewed mechanical keyboard in the catalog.",
        )
    )
    denial = next((c for c in over_budget.decision.checks if c.status.value == "fail"), None)
    cap_check = next((c for c in over_budget.decision.checks if c.id == "per_txn_cap"), None)

    # Now the agent re-plans against what is actually left and buys the cheaper one.
    recovery = _run_agent("buy a mechanical keyboard", token)

    mandate = mandates.get_record(mandate_id)
    return ScenarioResult(
        scenario_id=spec["id"],
        title=spec["title"],
        proves=spec["proves"],
        outcome=recovery["outcome"],
        summary=(
            f"Mouse settled at {_inr(first_amount(first))}. "
            f"The keyboard then cleared the per-transaction cap "
            f"({cap_check.status.value if cap_check else '?'}) but was denied on budget: "
            f"{denial.reason if denial else 'no denial recorded'} "
            f"The agent re-planned and {recovery['message']}"
            + (
                f" Mandate: {_inr(mandate.spent_paise)} spent of {_inr(mandate.total_budget_paise)}, "
                f"{_inr(mandate.available_paise)} left."
                if mandate
                else ""
            )
        ),
        mandate_id=mandate_id,
        mandate_token=token,
        steps=[
            first,
            {
                "over_budget_attempt": over_budget.decision.model_dump(),
                "intent_id": over_budget.intent.intent_id,
            },
            recovery,
        ],
        audit_tail=_audit_tail(35),
    )


def first_amount(run: dict[str, Any]) -> int:
    """Amount settled by an agent run, for the scenario summary."""
    for step in run.get("steps", []):
        if step["action"] == "select":
            return int(step["detail"].get("price_paise", 0))
    return 0


def _scenario_human_gate(spec: dict[str, Any]) -> ScenarioResult:
    token, mandate_id = _issue(spec, "demo: human gate")
    catalog.set_stock(HEADPHONES, 9)
    run = _run_agent("buy the best noise cancelling headphones you have", token)
    mandate = mandates.get_record(mandate_id)
    intent_id = run.get("intent_id")
    return ScenarioResult(
        scenario_id=spec["id"],
        title=spec["title"],
        proves=spec["proves"],
        outcome=run["outcome"],
        summary=(
            f"{run['message']} "
            + (
                f"Budget of {_inr(mandate.reserved_paise)} is held while it waits. "
                if mandate
                else ""
            )
            + (
                f"Approve or reject it: POST /policy/resolve with intent_id={intent_id}."
                if intent_id
                else ""
            )
        ),
        mandate_id=mandate_id,
        mandate_token=token,
        steps=[run],
        audit_tail=_audit_tail(),
    )


def _scenario_category_blocked(spec: dict[str, Any]) -> ScenarioResult:
    token, mandate_id = _issue(spec, "demo: category allow-list")
    # Named directly: the point is the guardrail refusing an off-scope category,
    # not whether retrieval happens to surface a yoga mat.
    response = intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token,
            product_id=YOGA_MAT,
            qty=1,
            agent_rationale="User asked for a yoga mat for morning stretches.",
        )
    )
    mandate = mandates.get_record(mandate_id)
    failed = next((c for c in response.decision.checks if c.status.value == "fail"), None)
    return ScenarioResult(
        scenario_id=spec["id"],
        title=spec["title"],
        proves=spec["proves"],
        outcome=response.decision.action.value,
        summary=(
            (failed.reason if failed else response.next_action)
            + (f" No budget was reserved: {_inr(mandate.reserved_paise)} held." if mandate else "")
        ),
        mandate_id=mandate_id,
        mandate_token=token,
        steps=[
            {
                "intent": response.intent.model_dump(),
                "decision": response.decision.model_dump(),
                "next_action": response.next_action,
            }
        ],
        audit_tail=_audit_tail(),
    )


def _scenario_out_of_stock(spec: dict[str, Any]) -> ScenarioResult:
    """A genuine mid-flow race: the item sells out between search and intent."""
    token, mandate_id = _issue(spec, "demo: out of stock")
    catalog.set_stock(MOUSE, 1)  # the last unit
    catalog.set_stock(VERTICAL_MOUSE, 18)

    sold_out: dict[str, Any] = {}

    def someone_else_buys_it(choice: Any) -> None:
        """Fires after the agent picks, before it raises the intent."""
        if not sold_out:
            catalog.set_stock(choice.product.id, 0)
            sold_out["product_id"] = choice.product.id
            sold_out["title"] = choice.product.title

    run = buyer.run_goal(
        goal="buy a wireless mouse under 2000",
        mandate_token=token,
        auto_pay=True,
        before_intent=someone_else_buys_it,
    ).model_dump()

    replanned = any(step["action"] == "replan" for step in run["steps"])
    return ScenarioResult(
        scenario_id=spec["id"],
        title=spec["title"],
        proves=spec["proves"],
        outcome=run["outcome"],
        summary=(
            f"The agent chose {sold_out.get('title', '?')}, and its last unit sold to someone "
            f"else before the intent was raised. The stock guardrail refused the sale"
            + (" and the agent re-searched mid-run. " if replanned else ". ")
            + run["message"]
        ),
        mandate_id=mandate_id,
        mandate_token=token,
        steps=[run],
        audit_tail=_audit_tail(30),
    )


def _scenario_payment_failure(spec: dict[str, Any]) -> ScenarioResult:
    token, mandate_id = _issue(spec, "demo: declined card")
    catalog.set_stock(MOUSE, 42)
    run = _run_agent("buy a wireless mouse under 1500", token, auto_pay=False)

    intent_id = run.get("intent_id")
    if not intent_id:
        raise HTTPException(status_code=500, detail="Scenario could not reach a checkout")
    payment = payments.get_payment_for_intent(intent_id)
    if payment is None or payment.rzp_payment_link_id is None:
        raise HTTPException(status_code=500, detail="Scenario could not open a payment link")

    before = mandates.get_record(mandate_id)
    result = payments.simulate_payment(
        payment_link_id=payment.rzp_payment_link_id, outcome="failure"
    )
    after = mandates.get_record(mandate_id)
    intent = intents.get_intent(intent_id)

    return ScenarioResult(
        scenario_id=spec["id"],
        title=spec["title"],
        proves=spec["proves"],
        outcome=intent.status.value if intent else result.get("status", "unknown"),
        summary=(
            f"The card was declined. Intent is {intent.status.value if intent else 'unknown'}. "
            f"Budget held before the failure: {_inr(before.reserved_paise) if before else '?'}; "
            f"after: {_inr(after.reserved_paise) if after else '?'}. "
            f"Spend is unchanged at {_inr(after.spent_paise) if after else '?'} -- a charge that "
            "did not succeed never consumed the buyer's budget."
        ),
        mandate_id=mandate_id,
        mandate_token=token,
        steps=[run, {"webhook_result": result}],
        audit_tail=_audit_tail(25),
    )


def _scenario_forged_mandate(spec: dict[str, Any]) -> ScenarioResult:
    token, mandate_id = _issue(spec, "demo: forged token")

    # Re-sign the payload with the wrong key, keeping the shape intact but raising
    # the cap. This is exactly what a token holder trying to widen their own scope
    # would produce, and the signature check is what stops it.
    original = jwt.decode(token, options={"verify_signature": False})
    tampered_claims = {**original, "per_txn_cap_paise": 99_999_900, "total_budget_paise": 99_999_900}
    forged = jwt.encode(tampered_claims, "attacker-does-not-know-the-secret", algorithm="HS256")

    verification = mandates.verify(forged)
    try:
        intents.create_intent(
            PurchaseIntentRequest(
                mandate_token=forged,
                product_id=HEADPHONES,
                qty=1,
                agent_rationale="Attempting to spend beyond the granted cap.",
            )
        )
        outcome, detail = "unexpectedly_allowed", "The forged mandate was NOT rejected."
    except intents.IntentError as exc:
        outcome, detail = "deny", str(exc)

    return ScenarioResult(
        scenario_id=spec["id"],
        title=spec["title"],
        proves=spec["proves"],
        outcome=outcome,
        summary=(
            f"A mandate edited to raise its own cap to {_inr(99_999_900)} was refused: {detail} "
            "Signature verification runs before any bound is even consulted."
        ),
        mandate_id=mandate_id,
        mandate_token=token,
        steps=[
            {
                "tampered_claims": {
                    "per_txn_cap_paise": tampered_claims["per_txn_cap_paise"],
                    "total_budget_paise": tampered_claims["total_budget_paise"],
                },
                "verification": verification.model_dump(),
            }
        ],
        audit_tail=_audit_tail(10),
    )



# --------------------------------------------------------------------------
# Growth scenarios -- the merchant's side of the counter
# --------------------------------------------------------------------------


def _scenario_offer_accepted(spec: dict[str, Any]) -> ScenarioResult:
    """The agent shops, the merchant offers, and the agent judges each offer."""
    token, mandate_id = _issue(spec, "demo: offer accepted")
    catalog.set_stock(MOUSE, 42)
    catalog.set_stock(VERTICAL_MOUSE, 18)
    run = _run_agent("buy a wireless mouse", token)

    considered = next(
        (step for step in run["steps"] if step["action"] == "consider_offers"), None
    )
    metrics = attribution.revenue_metrics()
    accepted = (considered or {}).get("detail", {}).get("accepted_offer_id")

    return ScenarioResult(
        scenario_id=spec["id"],
        title=spec["title"],
        proves=spec["proves"],
        outcome=run["outcome"],
        summary=(
            f"{run['message']} The agent weighed "
            f"{len((considered or {}).get('detail', {}).get('offers_considered', []))} offer(s) and "
            f"{'accepted one' if accepted else 'declined them all'}. "
            f"Revenue uplift so far: {_inr(metrics.uplift_paise)} on "
            f"{_inr(metrics.baseline_gmv_paise)} of baseline."
        ),
        mandate_id=mandate_id,
        mandate_token=token,
        steps=[run, {"revenue_metrics": metrics.model_dump()}],
        audit_tail=_audit_tail(),
    )


def _scenario_offer_refused_by_mandate(spec: dict[str, Any]) -> ScenarioResult:
    """Same product, two mandates. The tight one is offered less, on purpose."""
    tight_token, tight_id = _issue(spec, "demo: tight mandate")
    catalog.set_stock(MOUSE, 42)

    tight_mandate = mandates.get_record(tight_id)
    fitted = growth.quote_offers(MOUSE, tight_mandate)
    unfitted = growth.quote_offers(MOUSE, None)

    refused = [w for w in fitted.withheld if w.get("failed_check") == "buyer_bounds"]
    return ScenarioResult(
        scenario_id=spec["id"],
        title=spec["title"],
        proves=spec["proves"],
        outcome="suppressed" if refused else "published",
        summary=(
            f"Under a {_inr(tight_mandate.per_txn_cap_paise)} cap the merchant published "
            f"{len(fitted.offers)} offer(s) and withheld {len(refused)} that the buyer could not "
            f"have accepted. With no mandate presented, the same product yields "
            f"{len(unfitted.offers)} offer(s). The merchant does not push what the mandate forbids."
        ),
        mandate_id=tight_id,
        mandate_token=tight_token,
        steps=[
            {"fitted_to_mandate": fitted.model_dump()},
            {"unfitted": unfitted.model_dump()},
        ],
        audit_tail=_audit_tail(),
    )


def _scenario_margin_floor_holds(spec: dict[str, Any]) -> ScenarioResult:
    """Drive a product's cost up until a discount would breach the floor."""
    token, mandate_id = _issue(spec, "demo: margin floor")
    catalog.set_stock(MOUSE, 42)

    product = catalog.get_product(MOUSE)
    original_cost = growth_economics.get_cost_paise(MOUSE)
    # 96% of list leaves 4% gross margin: any discount at all breaches an 8% floor.
    growth_economics.set_cost_paise(MOUSE, int(product.price_paise * 0.96))

    listing = growth.quote_offers(MOUSE)
    refused = [w for w in listing.withheld if w.get("failed_check") == "margin_floor"]
    metrics = attribution.revenue_metrics()

    if original_cost is not None:
        growth_economics.set_cost_paise(MOUSE, original_cost)

    return ScenarioResult(
        scenario_id=spec["id"],
        title=spec["title"],
        proves=spec["proves"],
        outcome="suppressed" if refused else "published",
        summary=(
            f"With {product.title} carrying only 4% gross margin, the gauntlet refused "
            f"{len(refused)} offer(s) on the margin floor and published {len(listing.offers)}. "
            f"Margin protected across the run: {_inr(metrics.margin_protected_paise)}."
        ),
        mandate_id=mandate_id,
        mandate_token=token,
        steps=[{"offers": listing.model_dump()}, {"revenue_metrics": metrics.model_dump()}],
        audit_tail=_audit_tail(),
    )


def _scenario_deep_discount_gate(spec: dict[str, Any]) -> ScenarioResult:
    """A discount big enough to need a person, held rather than refused."""
    token, mandate_id = _issue(spec, "demo: deep discount")
    catalog.set_stock(CHAIR, 12)

    listing = growth.quote_offers(CHAIR)
    gated = [w for w in listing.withheld if w.get("failed_check") == "deep_discount_gate"]
    campaign = growth_campaigns.active_campaign()

    steps: list[dict[str, Any]] = [{"offers": listing.model_dump()}]
    if gated:
        stored = growth.get_offer(gated[0]["offer_id"], include_margin=True)
        steps.append(
            {
                "held": {
                    "offer_id": stored.offer.offer_id,
                    "status": stored.offer.status.value,
                    "discount_paise": stored.offer.discount_paise,
                    "campaign_reserved_paise": campaign.discount_reserved_paise if campaign else 0,
                    "checks": [c.model_dump() for c in stored.decision.checks],
                }
            }
        )

    return ScenarioResult(
        scenario_id=spec["id"],
        title=spec["title"],
        proves=spec["proves"],
        outcome="gated" if gated else "published",
        summary=(
            f"A bundle on the desk chair gives away "
            f"{_inr(gated[0].get('discount_paise', 0)) if gated and gated[0].get('discount_paise') else 'more than the threshold'}"
            f", so it is held for a person rather than suppressed. "
            f"The campaign is holding {_inr(campaign.discount_reserved_paise) if campaign else 'nothing'} "
            "while the decision is pending. Approve it from the Offer ledger."
        )
        if gated
        else "The chair's bundle cleared without needing a human this time.",
        mandate_id=mandate_id,
        mandate_token=token,
        steps=steps,
        audit_tail=_audit_tail(),
    )


RUNNERS = {
    "happy_path": _scenario_happy_path,
    "budget_exceeded": _scenario_budget_exceeded,
    "human_gate": _scenario_human_gate,
    "category_blocked": _scenario_category_blocked,
    "out_of_stock": _scenario_out_of_stock,
    "payment_failure": _scenario_payment_failure,
    "forged_mandate": _scenario_forged_mandate,
    "offer_accepted": _scenario_offer_accepted,
    "offer_refused_by_mandate": _scenario_offer_refused_by_mandate,
    "margin_floor_holds": _scenario_margin_floor_holds,
    "deep_discount_gate": _scenario_deep_discount_gate,
}


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------


@router.get("/scenarios", summary="List the demo scenarios")
def list_scenarios() -> dict:
    scenarios = _load_scenarios()
    return {
        "count": len(scenarios),
        "scenarios": [
            {**spec, "runnable": spec["id"] in RUNNERS} for spec in scenarios.values()
        ],
    }


@router.post("/scenarios/{scenario_id}", response_model=ScenarioResult, summary="Run one scenario")
def run_scenario(scenario_id: str) -> ScenarioResult:
    scenarios = _load_scenarios()
    spec = scenarios.get(scenario_id)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"No scenario '{scenario_id}'")
    runner = RUNNERS.get(scenario_id)
    if runner is None:  # pragma: no cover - every listed scenario has a runner
        raise HTTPException(status_code=501, detail=f"Scenario '{scenario_id}' has no runner")
    log.info("running demo scenario %s", scenario_id)
    return runner(spec)


@router.post("/reset", summary="Wipe state and re-seed the catalog")
def reset() -> dict:
    """Fresh database, fresh catalog, empty audit trail. Run before a demo."""
    reset_db()
    result = catalog.ingest_seed_file()
    # Costs and the campaign are part of a working merchant, not demo garnish: a
    # reset that dropped them would leave the growth agent unable to offer anything.
    growth_economics.seed_economics()
    growth_campaigns.ensure_default_campaign()
    audit.record(
        actor="operator",
        event_type="demo.reset",
        summary=f"Demo state reset; {result['ingested']} products re-ingested.",
        reasons=["Deterministic starting point so the demo is repeatable."],
        payload=result,
    )
    return {"reset": True, **result}


class QuickMandateRequest(Base):
    buyer_id: str = "buyer_asha"
    per_txn_cap_paise: int = 300000
    total_budget_paise: int = 1000000
    allowed_categories: list[str] = ["electronics", "office"]
    ttl_hours: int = 24


@router.post("/mandate", summary="Issue a ready-to-use demo mandate")
def quick_mandate(request: QuickMandateRequest) -> dict:
    settings = get_settings()
    issued = mandates.issue(
        MandateIssueRequest(
            buyer_id=request.buyer_id,
            merchant_id=settings.merchant_id,
            per_txn_cap_paise=request.per_txn_cap_paise,
            total_budget_paise=request.total_budget_paise,
            allowed_categories=request.allowed_categories,
            ttl_hours=request.ttl_hours,
            label="demo quick mandate",
        )
    )
    return {
        "mandate_token": issued.mandate_token,
        "mandate": issued.mandate.model_dump(),
        "hint": "Pass mandate_token to POST /intents or to the MCP create_purchase_intent tool.",
    }


@router.post("/resolve-gate/{intent_id}", summary="Approve or reject a gated intent")
def resolve(intent_id: str, approve: bool = True, resolved_by: str = "demo-operator") -> dict:
    try:
        result = intents.resolve_gate(
            ResolveGateRequest(intent_id=intent_id, approve=approve, resolved_by=resolved_by)
        )
    except intents.IntentError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    payload: dict[str, Any] = {
        "intent": result.intent.model_dump(),
        "decision": result.decision.model_dump(),
        "next_action": result.next_action,
    }
    if approve and result.intent.status.value == "APPROVED":
        confirmation = payments.start_checkout(
            intent_id=intent_id, mandate_token=_token_for(result.intent.mandate_id)
        )
        payload["checkout_url"] = confirmation.checkout_url
        payload["payment"] = confirmation.payment.model_dump()
    return payload


def _token_for(mandate_id: str) -> str:
    """Re-mint a token for a mandate the demo already issued.

    Safe here because the mandate record is the source of truth for scope; the
    token only ever carries what the record already says.
    """
    record = mandates.get_record(mandate_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"No mandate {mandate_id}")
    return mandates._encode(record)  # noqa: SLF001 - demo convenience only
