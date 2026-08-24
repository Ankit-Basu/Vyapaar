"""Payment execution and webhook settlement.

Two invariants this module exists to hold:

1. **Nothing charges without an approval.** `start_checkout` refuses any intent
   that is not already `APPROVED`, and only the policy engine or a human gate
   resolution can produce that status.
2. **Nothing settles without a verified signature.** An intent becomes `PAID`
   only inside `handle_webhook`, and only after HMAC-SHA256 over the raw request
   body matches `X-Razorpay-Signature`. A client POSTing "I paid, honest" gets a
   rejected-webhook audit row and nothing else.
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import uuid
from typing import Any

from ..audit import log as audit
from ..config import get_settings
from ..db import connect, transaction
from ..intents import service as intents
from ..mandate import service as mandates
from ..models import (
    ConfirmPurchaseResponse,
    IntentStatus,
    PaymentRecord,
    PaymentStatus,
    iso,
    utcnow,
)
from .gateway import (
    PaymentGatewayError,
    build_webhook_event,
    get_gateway,
    sign_event,
    verify_webhook_signature,
)

log = logging.getLogger("agentmandi.payments")

PAID_EVENTS = {"payment_link.paid", "order.paid", "payment.captured"}
FAILED_EVENTS = {"payment.failed", "payment_link.expired", "payment_link.cancelled"}


class PaymentError(Exception):
    """A payment request that cannot proceed. Message is safe to surface."""


class WebhookRejected(Exception):
    """The webhook did not authenticate. Never results in a state change."""


def _inr(paise: int) -> str:
    return f"INR {paise / 100:,.2f}"


def _row_to_payment(row: sqlite3.Row) -> PaymentRecord:
    return PaymentRecord(
        payment_id=row["payment_id"],
        intent_id=row["intent_id"],
        rzp_order_id=row["rzp_order_id"],
        rzp_payment_link_id=row["rzp_payment_link_id"],
        rzp_payment_id=row["rzp_payment_id"],
        short_url=row["short_url"],
        amount_paise=row["amount_paise"],
        status=PaymentStatus(row["status"]),
        mode=row["mode"],
        failure_reason=row["failure_reason"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def get_payment_for_intent(intent_id: str) -> PaymentRecord | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM payment WHERE intent_id = ? ORDER BY created_at DESC LIMIT 1",
            (intent_id,),
        ).fetchone()
    return _row_to_payment(row) if row else None


def list_payments(limit: int = 50) -> list[PaymentRecord]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM payment ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_row_to_payment(row) for row in rows]


# --------------------------------------------------------------------------
# Checkout
# --------------------------------------------------------------------------


def start_checkout(*, intent_id: str, mandate_token: str) -> ConfirmPurchaseResponse:
    settings = get_settings()
    gateway = get_gateway()

    mandate = mandates.require_valid(mandate_token)
    intent = intents.get_intent(intent_id)
    if intent is None:
        raise PaymentError(f"No intent with id {intent_id}")
    if intent.mandate_id != mandate.mandate_id:
        raise PaymentError(
            "That mandate did not raise this intent. A mandate can only pay for its own intents."
        )

    # The single gate between an agent's wish and an actual charge.
    if intent.status != IntentStatus.APPROVED:
        raise PaymentError(
            f"Intent {intent_id} is {intent.status.value}. Payment requires an APPROVED intent; "
            "the policy engine or a human gate resolution is the only way to reach that status."
        )

    decision = intents.get_decision(intent_id)
    if decision is None or not decision.allows_payment:
        raise PaymentError(
            "No policy decision on this intent permits payment. Refusing to charge."
        )

    existing = get_payment_for_intent(intent_id)
    if existing is not None and existing.status in (PaymentStatus.AWAITING_PAYMENT, PaymentStatus.PAID):
        return ConfirmPurchaseResponse(
            intent=intent,
            payment=existing,
            checkout_url=existing.short_url,
            message=f"Checkout already open for this intent ({existing.status.value}).",
        )

    notes = {
        "intent_id": intent.intent_id,
        "mandate_id": intent.mandate_id,
        "buyer_id": intent.buyer_id,
        "product_id": intent.product_id,
        "policy_decision": decision.action.value,
    }

    try:
        order = gateway.create_order(
            amount_paise=intent.amount_paise,
            receipt=intent.intent_id,
            notes=notes,
        )
        link = gateway.create_payment_link(
            amount_paise=intent.amount_paise,
            description=f"{intent.qty} x {intent.product_title} via AgentMandi",
            reference_id=intent.intent_id,
            notes=notes,
            callback_url=f"{settings.web_base_url.rstrip('/')}/checkout/return?intent_id={intent.intent_id}",
        )
    except PaymentGatewayError as exc:
        audit.record(
            actor="payment-service",
            event_type="payment.gateway_error",
            intent_id=intent.intent_id,
            mandate_id=intent.mandate_id,
            amount_paise=intent.amount_paise,
            summary=f"Razorpay refused to open a checkout for {intent.product_title}: {exc}",
            reasons=[str(exc)],
            payload={"mode": gateway.mode},
        )
        raise PaymentError(str(exc)) from exc

    payment_id = f"pay_rec_{uuid.uuid4().hex[:16]}"
    now = iso(utcnow())

    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO payment (payment_id, intent_id, rzp_order_id, rzp_payment_link_id,
                                 rzp_payment_id, short_url, amount_paise, status, mode,
                                 failure_reason, raw_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?)
            """,
            (
                payment_id,
                intent.intent_id,
                order.get("id"),
                link.get("id"),
                link.get("short_url"),
                intent.amount_paise,
                PaymentStatus.AWAITING_PAYMENT.value,
                gateway.mode,
                json.dumps({"order": order, "payment_link": link}, default=str),
                now,
                now,
            ),
        )
        audit.record(
            conn=conn,
            actor="payment-service",
            event_type="payment.initiated",
            intent_id=intent.intent_id,
            mandate_id=intent.mandate_id,
            amount_paise=intent.amount_paise,
            decision=decision.action.value,
            summary=(
                f"Razorpay order {order.get('id')} and payment link {link.get('id')} opened "
                f"for {_inr(intent.amount_paise)} ({gateway.mode} mode)"
            ),
            reasons=[
                "Checkout opened only because the intent was already APPROVED by the guardrails.",
                f"Budget of {_inr(intent.reserved_paise)} stays reserved until a verified webhook settles it.",
            ],
            payload={
                "rzp_order_id": order.get("id"),
                "rzp_payment_link_id": link.get("id"),
                "short_url": link.get("short_url"),
                "mode": gateway.mode,
                "notes": notes,
            },
        )

    payment = get_payment_for_intent(intent_id)
    assert payment is not None
    return ConfirmPurchaseResponse(
        intent=intent,
        payment=payment,
        checkout_url=payment.short_url,
        message=(
            f"Payment link ready for {_inr(intent.amount_paise)}. The intent becomes PAID only "
            "when Razorpay sends a webhook whose signature verifies."
        ),
    )


# --------------------------------------------------------------------------
# Webhook settlement
# --------------------------------------------------------------------------


def _locate_intent_id(body: dict[str, Any]) -> tuple[str | None, dict[str, Any]]:
    """Find the intent a webhook refers to, and collect the gateway ids it carries."""
    payload = body.get("payload", {}) or {}
    link = (payload.get("payment_link", {}) or {}).get("entity", {}) or {}
    order = (payload.get("order", {}) or {}).get("entity", {}) or {}
    payment = (payload.get("payment", {}) or {}).get("entity", {}) or {}

    ids = {
        "rzp_payment_link_id": link.get("id"),
        "rzp_order_id": order.get("id") or payment.get("order_id"),
        "rzp_payment_id": payment.get("id"),
    }

    # `notes` is the most direct route: we set intent_id on both the order and the link.
    for entity in (payment, link, order):
        notes = entity.get("notes") or {}
        if isinstance(notes, dict) and notes.get("intent_id"):
            return str(notes["intent_id"]), ids
    # `reference_id` on a payment link is the intent id too.
    if link.get("reference_id"):
        return str(link["reference_id"]), ids
    if order.get("receipt"):
        return str(order["receipt"]), ids

    with connect() as conn:
        for column, value in (
            ("rzp_payment_link_id", ids["rzp_payment_link_id"]),
            ("rzp_order_id", ids["rzp_order_id"]),
        ):
            if not value:
                continue
            row = conn.execute(
                f"SELECT intent_id FROM payment WHERE {column} = ? ORDER BY created_at DESC LIMIT 1",
                (value,),
            ).fetchone()
            if row:
                return row["intent_id"], ids
    return None, ids


def handle_webhook(
    *, raw_body: bytes, signature: str, event_id: str | None = None
) -> dict[str, Any]:
    """Authenticate, de-duplicate and apply a gateway webhook.

    Raises `WebhookRejected` without touching any state when the signature does
    not verify.
    """
    settings = get_settings()

    if not verify_webhook_signature(raw_body, signature, settings.razorpay_webhook_secret):
        audit.record(
            actor="payment-service",
            event_type="payment.webhook_rejected",
            summary="Rejected a webhook whose HMAC-SHA256 signature did not verify.",
            reasons=[
                "X-Razorpay-Signature did not match HMAC-SHA256(raw_body, webhook_secret). "
                "No intent was settled and no budget moved."
            ],
            payload={"body_sha256": hashlib.sha256(raw_body).hexdigest(), "body_bytes": len(raw_body)},
        )
        raise WebhookRejected("Webhook signature verification failed.")

    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise WebhookRejected(f"Webhook body is not valid JSON: {exc}") from exc

    event_type = str(body.get("event", "unknown"))
    dedupe_id = event_id or f"sha_{hashlib.sha256(raw_body).hexdigest()[:32]}"

    with transaction() as conn:
        already = conn.execute(
            "SELECT handled FROM webhook_event WHERE id = ?", (dedupe_id,)
        ).fetchone()
        if already is not None:
            return {
                "status": "duplicate",
                "event": event_type,
                "detail": "This webhook was already applied; ignoring the redelivery.",
            }
        conn.execute(
            """INSERT INTO webhook_event (id, received_at, event_type, signature_valid, handled, raw_json)
               VALUES (?, ?, ?, 1, 0, ?)""",
            (dedupe_id, iso(utcnow()), event_type, raw_body.decode("utf-8", errors="replace")),
        )

    intent_id, gateway_ids = _locate_intent_id(body)

    with transaction() as conn:
        audit.record(
            conn=conn,
            actor="razorpay-webhook",
            event_type="payment.webhook_verified",
            intent_id=intent_id,
            summary=f"Verified webhook '{event_type}' received for intent {intent_id or '(unmatched)'}",
            reasons=["HMAC-SHA256 signature matched the configured webhook secret."],
            payload={"event": event_type, **gateway_ids},
        )

        if intent_id is None:
            conn.execute("UPDATE webhook_event SET handled = 1 WHERE id = ?", (dedupe_id,))
            return {
                "status": "unmatched",
                "event": event_type,
                "detail": "Signature verified but no local intent matches this event.",
            }

        for column, value in gateway_ids.items():
            if value:
                conn.execute(
                    f"UPDATE payment SET {column} = ?, updated_at = ? WHERE intent_id = ?",
                    (value, iso(utcnow()), intent_id),
                )

        outcome: str
        if event_type in PAID_EVENTS:
            conn.execute(
                "UPDATE payment SET status = ?, updated_at = ? WHERE intent_id = ?",
                (PaymentStatus.PAID.value, iso(utcnow()), intent_id),
            )
            intents.mark_paid(intent_id, conn, {"event": event_type, **gateway_ids})
            outcome = "paid"
        elif event_type in FAILED_EVENTS:
            payment_entity = (body.get("payload", {}).get("payment", {}) or {}).get("entity", {}) or {}
            reason = (
                payment_entity.get("error_description")
                or payment_entity.get("error_reason")
                or f"gateway reported {event_type}"
            )
            conn.execute(
                "UPDATE payment SET status = ?, failure_reason = ?, updated_at = ? WHERE intent_id = ?",
                (PaymentStatus.FAILED.value, reason, iso(utcnow()), intent_id),
            )
            intents.mark_failed(intent_id, conn, reason, {"event": event_type, **gateway_ids})
            outcome = "failed"
        else:
            outcome = "ignored"
            audit.record(
                conn=conn,
                actor="payment-service",
                event_type="payment.webhook_ignored",
                intent_id=intent_id,
                summary=f"Webhook '{event_type}' carries no state change for AgentMandi.",
                reasons=[f"'{event_type}' is not in the paid or failed event sets."],
                payload={"event": event_type},
            )

        conn.execute("UPDATE webhook_event SET handled = 1 WHERE id = ?", (dedupe_id,))

    return {"status": outcome, "event": event_type, "intent_id": intent_id}


# --------------------------------------------------------------------------
# Simulator (only reachable when PAYMENTS_MODE resolves to `simulated`)
# --------------------------------------------------------------------------


def simulate_payment(*, payment_link_id: str, outcome: str = "success") -> dict[str, Any]:
    """Emit a correctly-signed webhook for a simulated payment link.

    This builds the event body, signs it with the webhook secret, and hands the
    bytes to the very same `handle_webhook` the HTTP endpoint calls -- so the
    signature check runs for real rather than being bypassed for the demo.
    """
    if get_gateway().mode != "simulated":
        raise PaymentError(
            "The payment simulator is disabled because real Razorpay test keys are configured. "
            "Pay the Razorpay link instead and let the real webhook settle it."
        )

    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM payment WHERE rzp_payment_link_id = ? ORDER BY created_at DESC LIMIT 1",
            (payment_link_id,),
        ).fetchone()
    if row is None:
        raise PaymentError(f"No payment on record for link {payment_link_id}")
    payment = _row_to_payment(row)
    stored = json.loads(row["raw_json"])
    order = stored.get("order", {})
    link = stored.get("payment_link", {})
    notes = link.get("notes") or {}

    succeeded = outcome == "success"
    payment_entity: dict[str, Any] = {
        "id": f"pay_{uuid.uuid4().hex[:14]}",
        "entity": "payment",
        "amount": payment.amount_paise,
        "currency": "INR",
        "status": "captured" if succeeded else "failed",
        "order_id": payment.rzp_order_id,
        "method": "card",
        "notes": notes,
    }
    if not succeeded:
        # Mirrors what Razorpay returns for the test failure card.
        payment_entity |= {
            "error_code": "BAD_REQUEST_ERROR",
            "error_description": "Payment failed because the card issuer declined the transaction.",
            "error_source": "issuer",
            "error_step": "payment_authorization",
            "error_reason": "payment_failed",
        }

    event_body = build_webhook_event(
        event="payment_link.paid" if succeeded else "payment.failed",
        payment_link={**link, "status": "paid" if succeeded else "created",
                      "amount_paid": payment.amount_paise if succeeded else 0},
        order={**order, "status": "paid" if succeeded else "attempted",
               "amount_paid": payment.amount_paise if succeeded else 0},
        payment=payment_entity,
    )
    raw, signature = sign_event(event_body)
    return handle_webhook(
        raw_body=raw, signature=signature, event_id=f"sim_{uuid.uuid4().hex[:20]}"
    )
