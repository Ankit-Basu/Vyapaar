"""Purchase intents: the only route from "an agent wants to buy" to "money moves".

The sequence is fixed and there is no way around it:

    create_intent  ->  guardrails evaluate  ->  APPROVED | GATED | DENIED
    GATED          ->  a human resolves it  ->  APPROVED | DENIED
    APPROVED       ->  confirm_purchase     ->  Razorpay order + payment link
    verified webhook                        ->  PAID (budget settles, stock ships)

`confirm_purchase` refuses to touch the payment service unless the intent is
already APPROVED, and only the policy engine or a human gate resolution can set
that status. An agent cannot mint an approval for itself.

Budget is held the moment an intent is approved or gated, and only converted to
settled spend by a verified webhook. A payment that fails releases the hold, so a
failed charge never quietly consumes the buyer's budget.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from typing import Any

from ..audit import log as audit
from ..catalog import store as catalog
from ..config import get_settings
from ..db import connect, transaction
from ..growth import service as growth
from ..mandate import service as mandates
from ..models import (
    Decision,
    DecisionAction,
    IntentStatus,
    MandateRecord,
    PurchaseIntent,
    PurchaseIntentRequest,
    PurchaseIntentResponse,
    ResolveGateRequest,
    iso,
    utcnow,
)
from ..policy.engine import EvaluationContext, evaluate

log = logging.getLogger("vyapaar.intents")


class IntentError(Exception):
    """A request that cannot proceed. The message is safe to surface to an agent."""


def _inr(paise: int) -> str:
    return f"INR {paise / 100:,.2f}"


def _row_to_intent(row: sqlite3.Row) -> PurchaseIntent:
    return PurchaseIntent(
        intent_id=row["intent_id"],
        mandate_id=row["mandate_id"],
        buyer_id=row["buyer_id"],
        merchant_id=row["merchant_id"],
        product_id=row["product_id"],
        product_title=row["product_title"],
        category=row["category"],
        unit_price_paise=row["unit_price_paise"],
        qty=row["qty"],
        amount_paise=row["amount_paise"],
        status=IntentStatus(row["status"]),
        agent_rationale=row["agent_rationale"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        reserved_paise=row["reserved_paise"],
        offer_id=row["offer_id"],
        list_amount_paise=row["list_amount_paise"],
        discount_paise=row["discount_paise"],
    )


def _read_mandate(conn: sqlite3.Connection, mandate_id: str) -> MandateRecord | None:
    row = conn.execute("SELECT * FROM mandate WHERE mandate_id = ?", (mandate_id,)).fetchone()
    if row is None:
        return None
    return MandateRecord(
        mandate_id=row["mandate_id"],
        buyer_id=row["buyer_id"],
        merchant_id=row["merchant_id"],
        per_txn_cap_paise=row["per_txn_cap_paise"],
        total_budget_paise=row["total_budget_paise"],
        spent_paise=row["spent_paise"],
        reserved_paise=row["reserved_paise"],
        allowed_categories=json.loads(row["allowed_categories_json"]),
        issued_at=row["issued_at"],
        expires_at=row["expires_at"],
        revoked_at=row["revoked_at"],
        label=row["label"],
    )


def get_intent(intent_id: str) -> PurchaseIntent | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM purchase_intent WHERE intent_id = ?", (intent_id,)
        ).fetchone()
    return _row_to_intent(row) if row else None


def get_decision(intent_id: str) -> Decision | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT decision_json FROM purchase_intent WHERE intent_id = ?", (intent_id,)
        ).fetchone()
    if row is None or not row["decision_json"]:
        return None
    return Decision.model_validate_json(row["decision_json"])


def list_intents(*, limit: int = 50, status: str | None = None) -> list[PurchaseIntent]:
    where, params = ("WHERE status = ?", [status]) if status else ("", [])
    with connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM purchase_intent {where} ORDER BY created_at DESC LIMIT ?",
            [*params, limit],
        ).fetchall()
    return [_row_to_intent(row) for row in rows]


def _next_action(status: IntentStatus, decision: Decision) -> str:
    if status == IntentStatus.APPROVED:
        return (
            "Guardrails cleared this purchase. Call POST /intents/confirm with the same "
            "mandate token to create the Razorpay order and payment link."
        )
    if status == IntentStatus.GATED:
        return (
            "Held for human review. A person must approve or reject it on the dashboard "
            "(POST /policy/resolve). Budget is reserved in the meantime, so nothing else "
            "can spend it while the decision is pending."
        )
    return (
        "Denied. Do not retry this intent unchanged: "
        + (decision.reasons[0] if decision.reasons else "a guardrail refused it.")
    )


# --------------------------------------------------------------------------
# Create
# --------------------------------------------------------------------------


def create_intent(request: PurchaseIntentRequest) -> PurchaseIntentResponse:
    settings = get_settings()

    verification = mandates.verify(request.mandate_token)
    mandate_record = verification.record
    product = catalog.get_product(request.product_id)

    # An accepted offer is resolved server-side from its id alone. The growth layer
    # re-prices it against the live catalog; whatever it says here is what the buyer
    # owes, and any drift becomes an `offer_honoured` denial rather than a surprise.
    offer = None
    offer_invalid_reason = None
    offer_line_products: dict[str, object] = {}
    if request.offer_id:
        offer, _offer_decision, offer_invalid_reason = growth.verify_for_intent(request.offer_id)
        if offer is not None:
            offer_line_products = {
                line.product_id: catalog.get_product(line.product_id)
                for line in offer.lines
                if catalog.get_product(line.product_id) is not None
            }

    # An upgrade offer replaces the product the agent came for, so the intent has
    # to record what is actually being bought rather than what was searched for.
    # Its `offer.anchor_product_id` still remembers the original choice, which is
    # what revenue attribution measures the uplift against.
    effective_product_id = request.product_id
    if offer is not None and not offer_invalid_reason and offer.lines:
        primary = next((line for line in offer.lines if line.is_anchor), offer.lines[0])
        effective_product_id = primary.product_id
        primary_product = catalog.get_product(primary.product_id)
        if primary_product is not None:
            product = primary_product

    if product is None:
        amount_paise = 0
        unit_price = 0
    elif offer is not None and not offer_invalid_reason:
        unit_price = product.price_paise
        amount_paise = offer.offer_total_paise
    else:
        unit_price = product.price_paise
        amount_paise = unit_price * request.qty

    if mandate_record is None:
        # Nothing to attach an intent row to, but the attempt is still auditable.
        audit.record(
            actor="buyer-agent",
            event_type="intent.rejected",
            summary=f"Purchase attempt for {request.product_id} refused: {verification.reason}",
            decision=DecisionAction.DENY.value,
            reasons=[verification.reason],
            payload={"product_id": request.product_id, "qty": request.qty},
        )
        raise IntentError(verification.reason)

    # Idempotency: the same key from the same mandate returns the original decision
    # rather than raising a second intent (and a second budget hold).
    if request.idempotency_key:
        with connect() as conn:
            existing = conn.execute(
                "SELECT * FROM purchase_intent WHERE mandate_id = ? AND idempotency_key = ?",
                (mandate_record.mandate_id, request.idempotency_key),
            ).fetchone()
        if existing is not None:
            intent = _row_to_intent(existing)
            decision = Decision.model_validate_json(existing["decision_json"])
            fresh = mandates.get_record(intent.mandate_id) or mandate_record
            return PurchaseIntentResponse(
                intent=intent,
                decision=decision,
                mandate=fresh,
                next_action=_next_action(intent.status, decision),
            )

    intent_id = f"int_{uuid.uuid4().hex[:20]}"
    now = iso(utcnow())

    with transaction() as conn:
        # Re-read the mandate under the write lock: budget must be evaluated against
        # what is true right now, not what was true when the request arrived.
        live_mandate = _read_mandate(conn, mandate_record.mandate_id)
        if live_mandate is None:  # pragma: no cover - the row was just verified
            raise IntentError("Mandate disappeared between verification and evaluation.")

        ctx = EvaluationContext(
            merchant_id=settings.merchant_id,
            product_id=effective_product_id,
            qty=request.qty,
            amount_paise=amount_paise,
            hitl_threshold_paise=settings.hitl_threshold_paise,
            max_qty_per_intent=settings.max_qty_per_intent,
            mandate=live_mandate if verification.valid else None,
            mandate_invalid_reason=None if verification.valid else verification.reason,
            product=product,
            offer=offer if not offer_invalid_reason else None,
            offer_invalid_reason=offer_invalid_reason,
            offer_line_products=offer_line_products,
        )
        decision = evaluate(ctx)

        reserved = 0
        if decision.action in (DecisionAction.AUTO_APPROVE, DecisionAction.GATE_FOR_HUMAN):
            # Hold the money now. A gated intent reserves too, otherwise a second
            # purchase could drain the budget while a human is still deciding.
            if mandates.reserve(live_mandate.mandate_id, amount_paise, conn):
                reserved = amount_paise
            else:  # pragma: no cover - the write lock makes this near-impossible
                decision = Decision(
                    action=DecisionAction.DENY,
                    reasons=[
                        "Budget was committed by a concurrent purchase between evaluation "
                        "and reservation; this intent was refused rather than overspending."
                    ],
                    checks=decision.checks,
                    evaluated_at=iso(utcnow()),
                )

        status = {
            DecisionAction.AUTO_APPROVE: IntentStatus.APPROVED,
            DecisionAction.GATE_FOR_HUMAN: IntentStatus.GATED,
            DecisionAction.DENY: IntentStatus.DENIED,
        }[decision.action]

        conn.execute(
            """
            INSERT INTO purchase_intent (
                intent_id, mandate_id, buyer_id, merchant_id, product_id, product_title,
                category, unit_price_paise, qty, amount_paise, status, agent_rationale,
                reserved_paise, idempotency_key, decision_json, offer_id,
                list_amount_paise, discount_paise, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                intent_id,
                live_mandate.mandate_id,
                live_mandate.buyer_id,
                settings.merchant_id,
                effective_product_id,
                product.title if product else "(unknown product)",
                product.category if product else "(unknown)",
                unit_price,
                request.qty,
                amount_paise,
                IntentStatus.PENDING.value,
                request.agent_rationale,
                reserved,
                request.idempotency_key,
                decision.model_dump_json(),
                offer.offer_id if offer is not None and not offer_invalid_reason else None,
                offer.list_total_paise if offer is not None and not offer_invalid_reason else 0,
                offer.discount_paise if offer is not None and not offer_invalid_reason else 0,
                now,
                now,
            ),
        )

        # An offer that was actually taken up stops being available to anyone else,
        # and its discount hold now belongs to this intent.
        if offer is not None and not offer_invalid_reason and decision.action in (
            DecisionAction.AUTO_APPROVE,
            DecisionAction.GATE_FOR_HUMAN,
        ):
            growth.mark_accepted(offer.offer_id, intent_id, live_mandate.buyer_id, conn)
            audit.record(
                conn=conn,
                actor="buyer-agent",
                event_type="offer.accepted",
                intent_id=intent_id,
                mandate_id=live_mandate.mandate_id,
                amount_paise=offer.discount_paise,
                summary=(
                    f"Agent accepted {offer.kind.value} offer {offer.offer_id}: paying "
                    f"{_inr(offer.offer_total_paise)} instead of "
                    f"{_inr(offer.list_total_paise)}"
                ),
                reasons=[offer.disclosure],
                payload={
                    "offer_id": offer.offer_id,
                    "kind": offer.kind.value,
                    "discount_paise": offer.discount_paise,
                    "baseline_paise": offer.lines[0].unit_price_paise,
                },
            )

        audit.record(
            conn=conn,
            actor="buyer-agent",
            event_type="intent.created",
            intent_id=intent_id,
            mandate_id=live_mandate.mandate_id,
            amount_paise=amount_paise,
            summary=(
                f"Agent raised an intent to buy {request.qty} x "
                f"{product.title if product else request.product_id} for {_inr(amount_paise)}"
            ),
            reasons=[request.agent_rationale] if request.agent_rationale else [],
            payload={
                "product_id": request.product_id,
                "qty": request.qty,
                "unit_price_paise": unit_price,
                "agent_rationale": request.agent_rationale,
            },
        )

        conn.execute(
            "UPDATE purchase_intent SET status = ?, updated_at = ? WHERE intent_id = ?",
            (status.value, iso(utcnow()), intent_id),
        )

        audit.record(
            conn=conn,
            actor="policy-engine",
            event_type="policy.decision",
            intent_id=intent_id,
            mandate_id=live_mandate.mandate_id,
            amount_paise=amount_paise,
            decision=decision.action.value,
            summary=(
                f"Guardrails returned {decision.action.value.upper()} for {_inr(amount_paise)}: "
                f"{decision.reasons[0] if decision.reasons else 'no reason recorded'}"
            ),
            reasons=decision.reasons,
            payload={
                "policy_version": decision.policy_version,
                "checks": [check.model_dump() for check in decision.checks],
                "reserved_paise": reserved,
            },
        )

        final_mandate = _read_mandate(conn, live_mandate.mandate_id)

    intent = get_intent(intent_id)
    assert intent is not None
    return PurchaseIntentResponse(
        intent=intent,
        decision=decision,
        mandate=final_mandate or mandate_record,
        next_action=_next_action(status, decision),
    )


# --------------------------------------------------------------------------
# Human-in-the-loop gate resolution
# --------------------------------------------------------------------------


def resolve_gate(request: ResolveGateRequest) -> PurchaseIntentResponse:
    settings = get_settings()

    with transaction() as conn:
        row = conn.execute(
            "SELECT * FROM purchase_intent WHERE intent_id = ?", (request.intent_id,)
        ).fetchone()
        if row is None:
            raise IntentError(f"No intent with id {request.intent_id}")
        intent = _row_to_intent(row)
        if intent.status != IntentStatus.GATED:
            raise IntentError(
                f"Intent {intent.intent_id} is {intent.status.value}, not GATED; "
                "only a gated intent can be resolved by a human."
            )

        prior = Decision.model_validate_json(row["decision_json"])
        live_mandate = _read_mandate(conn, intent.mandate_id)
        product = catalog.get_product(intent.product_id)

        if not request.approve:
            mandates.release(intent.mandate_id, intent.reserved_paise, conn)
            conn.execute(
                """UPDATE purchase_intent
                      SET status = ?, reserved_paise = 0, updated_at = ?
                    WHERE intent_id = ?""",
                (IntentStatus.DENIED.value, iso(utcnow()), intent.intent_id),
            )
            decision = Decision(
                action=DecisionAction.DENY,
                reasons=[
                    f"Rejected by {request.resolved_by} at the human review gate."
                    + (f" Note: {request.note}" if request.note else "")
                ],
                checks=prior.checks,
                evaluated_at=iso(utcnow()),
            )
            conn.execute(
                "UPDATE purchase_intent SET decision_json = ? WHERE intent_id = ?",
                (decision.model_dump_json(), intent.intent_id),
            )
            audit.record(
                conn=conn,
                actor=f"human:{request.resolved_by}",
                event_type="policy.gate_rejected",
                intent_id=intent.intent_id,
                mandate_id=intent.mandate_id,
                amount_paise=intent.amount_paise,
                decision=DecisionAction.DENY.value,
                summary=(
                    f"Human rejected the gated purchase of {_inr(intent.amount_paise)} "
                    f"({intent.product_title}); budget hold released"
                ),
                reasons=decision.reasons,
                payload={"resolved_by": request.resolved_by, "note": request.note},
            )
            final_mandate = _read_mandate(conn, intent.mandate_id)
            status = IntentStatus.DENIED
        else:
            # Re-run every guardrail against current state. A human approving a gate
            # waives the high-value threshold; it does not waive stock, category or
            # budget, which may have changed while the intent sat waiting.
            ctx = EvaluationContext(
                merchant_id=settings.merchant_id,
                product_id=intent.product_id,
                qty=intent.qty,
                amount_paise=intent.amount_paise,
                hitl_threshold_paise=intent.amount_paise + 1,  # gate already satisfied by the human
                max_qty_per_intent=settings.max_qty_per_intent,
                mandate=live_mandate,
                product=product,
                self_reserved_paise=intent.reserved_paise,
            )
            decision = evaluate(ctx)

            if decision.action == DecisionAction.DENY:
                mandates.release(intent.mandate_id, intent.reserved_paise, conn)
                conn.execute(
                    """UPDATE purchase_intent
                          SET status = ?, reserved_paise = 0, decision_json = ?, updated_at = ?
                        WHERE intent_id = ?""",
                    (
                        IntentStatus.DENIED.value,
                        decision.model_dump_json(),
                        iso(utcnow()),
                        intent.intent_id,
                    ),
                )
                status = IntentStatus.DENIED
                audit.record(
                    conn=conn,
                    actor="policy-engine",
                    event_type="policy.gate_approved_but_denied",
                    intent_id=intent.intent_id,
                    mandate_id=intent.mandate_id,
                    amount_paise=intent.amount_paise,
                    decision=DecisionAction.DENY.value,
                    summary=(
                        f"{request.resolved_by} approved the gate, but re-running the guardrails "
                        f"denied it: {decision.reasons[0] if decision.reasons else 'unknown'}"
                    ),
                    reasons=decision.reasons,
                    payload={"checks": [c.model_dump() for c in decision.checks]},
                )
            else:
                decision = Decision(
                    action=DecisionAction.AUTO_APPROVE,
                    reasons=[
                        f"Approved by {request.resolved_by} at the human review gate; "
                        "all other guardrails re-verified against current state."
                        + (f" Note: {request.note}" if request.note else "")
                    ],
                    checks=decision.checks,
                    evaluated_at=iso(utcnow()),
                )
                conn.execute(
                    """UPDATE purchase_intent
                          SET status = ?, decision_json = ?, updated_at = ?
                        WHERE intent_id = ?""",
                    (
                        IntentStatus.APPROVED.value,
                        decision.model_dump_json(),
                        iso(utcnow()),
                        intent.intent_id,
                    ),
                )
                status = IntentStatus.APPROVED
                audit.record(
                    conn=conn,
                    actor=f"human:{request.resolved_by}",
                    event_type="policy.gate_approved",
                    intent_id=intent.intent_id,
                    mandate_id=intent.mandate_id,
                    amount_paise=intent.amount_paise,
                    decision=DecisionAction.AUTO_APPROVE.value,
                    summary=(
                        f"Human approved the gated purchase of {_inr(intent.amount_paise)} "
                        f"({intent.product_title})"
                    ),
                    reasons=decision.reasons,
                    payload={"resolved_by": request.resolved_by, "note": request.note},
                )
            final_mandate = _read_mandate(conn, intent.mandate_id)

    updated = get_intent(request.intent_id)
    assert updated is not None and final_mandate is not None
    return PurchaseIntentResponse(
        intent=updated,
        decision=decision,
        mandate=final_mandate,
        next_action=_next_action(status, decision),
    )


# --------------------------------------------------------------------------
# Status transitions driven by verified payment webhooks
# --------------------------------------------------------------------------


def mark_paid(intent_id: str, conn: sqlite3.Connection, payload: dict[str, Any]) -> PurchaseIntent | None:
    """Settle budget, consume stock and mark the intent PAID. Idempotent."""
    row = conn.execute("SELECT * FROM purchase_intent WHERE intent_id = ?", (intent_id,)).fetchone()
    if row is None:
        return None
    intent = _row_to_intent(row)
    if intent.status == IntentStatus.PAID:
        return intent

    settled = mandates.settle(intent.mandate_id, intent.reserved_paise, conn)

    # A bundle ships every line, not just the anchor the agent searched for, so
    # stock comes off each of them. The discount hold settles alongside the buyer's
    # budget: the money the merchant gave away is only really given away once the
    # payment clears.
    if intent.offer_id:
        growth.settle_for_intent(intent_id, conn)
        offer = growth.get_offer(intent.offer_id)
        lines = offer.offer.lines if offer else []
        stock_ok = all(
            catalog.decrement_stock(line.product_id, line.qty, conn) for line in lines
        ) if lines else catalog.decrement_stock(intent.product_id, intent.qty, conn)
    else:
        stock_ok = catalog.decrement_stock(intent.product_id, intent.qty, conn)
    conn.execute(
        "UPDATE purchase_intent SET status = ?, reserved_paise = 0, updated_at = ? WHERE intent_id = ?",
        (IntentStatus.PAID.value, iso(utcnow()), intent_id),
    )

    mandate = _read_mandate(conn, intent.mandate_id)
    audit.record(
        conn=conn,
        actor="payment-service",
        event_type="intent.paid",
        intent_id=intent_id,
        mandate_id=intent.mandate_id,
        amount_paise=intent.amount_paise,
        decision="settled",
        summary=(
            f"Payment confirmed for {intent.product_title}: {_inr(intent.amount_paise)} settled. "
            f"Mandate spend is now {_inr(mandate.spent_paise)} of {_inr(mandate.total_budget_paise)}."
            if mandate
            else f"Payment confirmed for {intent.product_title}."
        ),
        reasons=[
            "Marked PAID only after a webhook whose HMAC-SHA256 signature verified against "
            "the webhook secret. A client claiming success is never sufficient.",
        ],
        payload={
            "budget_settled": settled,
            "stock_decremented": stock_ok,
            "spent_paise": mandate.spent_paise if mandate else None,
            "available_paise": mandate.available_paise if mandate else None,
            "gateway_event": payload,
        },
    )
    return _row_to_intent(
        conn.execute("SELECT * FROM purchase_intent WHERE intent_id = ?", (intent_id,)).fetchone()
    )


def mark_failed(
    intent_id: str, conn: sqlite3.Connection, reason: str, payload: dict[str, Any]
) -> PurchaseIntent | None:
    """Release the budget hold and mark the intent FAILED. Idempotent."""
    row = conn.execute("SELECT * FROM purchase_intent WHERE intent_id = ?", (intent_id,)).fetchone()
    if row is None:
        return None
    intent = _row_to_intent(row)
    if intent.status in (IntentStatus.FAILED, IntentStatus.PAID):
        return intent

    released = mandates.release(intent.mandate_id, intent.reserved_paise, conn)
    if intent.offer_id:
        # A failed charge never consumes discount budget either. The campaign gets
        # its money back exactly as the buyer's mandate does.
        growth.release_for_intent(intent_id, conn)
    conn.execute(
        "UPDATE purchase_intent SET status = ?, reserved_paise = 0, updated_at = ? WHERE intent_id = ?",
        (IntentStatus.FAILED.value, iso(utcnow()), intent_id),
    )

    mandate = _read_mandate(conn, intent.mandate_id)
    audit.record(
        conn=conn,
        actor="payment-service",
        event_type="intent.failed",
        intent_id=intent_id,
        mandate_id=intent.mandate_id,
        amount_paise=intent.amount_paise,
        decision="released",
        summary=(
            f"Payment failed for {intent.product_title} ({_inr(intent.amount_paise)}): {reason}. "
            f"Budget hold released; {_inr(mandate.available_paise)} remains available."
            if mandate
            else f"Payment failed for {intent.product_title}: {reason}"
        ),
        reasons=[
            reason,
            "The budget hold was released rather than spent: a charge that did not "
            "succeed must not consume the buyer's budget.",
        ],
        payload={
            "hold_released": released,
            "released_paise": intent.reserved_paise,
            "available_paise": mandate.available_paise if mandate else None,
            "gateway_event": payload,
        },
    )
    return _row_to_intent(
        conn.execute("SELECT * FROM purchase_intent WHERE intent_id = ?", (intent_id,)).fetchone()
    )
