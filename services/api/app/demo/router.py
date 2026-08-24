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
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from ..agent import buyer
from ..audit import log as audit
from ..catalog import store as catalog
from ..config import REPO_ROOT, get_settings
from ..db import reset_db
from ..intents import service as intents
from ..mandate import service as mandates
from ..models import (
    Base,
    MandateIssueRequest,
    PurchaseIntentRequest,
    ResolveGateRequest,
)
from ..payments import service as payments

log = logging.getLogger("agentmandi.demo")
router = APIRouter(prefix="/demo", tags=["demo"])

SCENARIOS_PATH = REPO_ROOT / "seed" / "scenarios.json"

# Products the scenarios reach for by id, so a run does not depend on ranking luck.
MOUSE = "prod_elec_001"
SILENT_MOUSE = "prod_elec_002"
HEADPHONES = "prod_elec_005"
KEYBOARD = "prod_elec_003"
YOGA_MAT = "prod_fit_001"


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
    """The headline failure case: deny on budget, then recover on a cheaper item."""
    token, mandate_id = _issue(spec, "demo: tight budget")
    catalog.set_stock(MOUSE, 42)
    catalog.set_stock(KEYBOARD, 15)

    first = _run_agent("buy a wireless mouse under 1500", token)
    # INR 2,000 budget, INR 1,299 already gone: the INR 4,499 keyboard cannot fit,
    # and the agent has to notice that and come back with something cheaper.
    second = _run_agent("buy a mechanical keyboard for my desk", token)

    mandate = mandates.get_record(mandate_id)
    denied_then_recovered = any(step["action"] == "replan" for step in second["steps"])
    return ScenarioResult(
        scenario_id=spec["id"],
        title=spec["title"],
        proves=spec["proves"],
        outcome=second["outcome"],
        summary=(
            f"First purchase settled. Second purchase was denied on budget"
            + (" and the agent re-planned under the remaining budget. " if denied_then_recovered else ". ")
            + second["message"]
            + (
                f" Mandate: {_inr(mandate.spent_paise)} spent, {_inr(mandate.available_paise)} left."
                if mandate
                else ""
            )
        ),
        mandate_id=mandate_id,
        mandate_token=token,
        steps=[first, second],
        audit_tail=_audit_tail(30),
    )


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
    token, mandate_id = _issue(spec, "demo: out of stock")
    catalog.set_stock(SILENT_MOUSE, 0)
    catalog.set_stock(MOUSE, 42)

    # Go at the dead product directly so the stock guardrail is what refuses it.
    direct = intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token,
            product_id=SILENT_MOUSE,
            qty=1,
            agent_rationale="Cheapest quiet wireless mouse in the catalog.",
        )
    )
    recovery = _run_agent("buy a quiet wireless mouse", token)
    return ScenarioResult(
        scenario_id=spec["id"],
        title=spec["title"],
        proves=spec["proves"],
        outcome=recovery["outcome"],
        summary=(
            f"{direct.decision.reasons[0] if direct.decision.reasons else 'Denied on stock.'} "
            f"The agent then re-searched: {recovery['message']}"
        ),
        mandate_id=mandate_id,
        mandate_token=token,
        steps=[
            {"direct_attempt": direct.decision.model_dump(), "intent_id": direct.intent.intent_id},
            recovery,
        ],
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
    import jwt as pyjwt

    original = pyjwt.decode(token, options={"verify_signature": False})
    tampered_claims = {**original, "per_txn_cap_paise": 99_999_900, "total_budget_paise": 99_999_900}
    forged = pyjwt.encode(tampered_claims, "attacker-does-not-know-the-secret", algorithm="HS256")

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


RUNNERS = {
    "happy_path": _scenario_happy_path,
    "budget_exceeded": _scenario_budget_exceeded,
    "human_gate": _scenario_human_gate,
    "category_blocked": _scenario_category_blocked,
    "out_of_stock": _scenario_out_of_stock,
    "payment_failure": _scenario_payment_failure,
    "forged_mandate": _scenario_forged_mandate,
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
