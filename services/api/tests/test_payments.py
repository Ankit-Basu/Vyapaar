"""Payment execution and webhook settlement.

The two invariants under test: nothing charges without an approval, and nothing
settles without a verified signature.
"""

from __future__ import annotations

import json

import pytest

from app.config import get_settings
from app.intents import service as intents
from app.mandate import service as mandates
from app.models import (
    IntentStatus,
    MandateIssueRequest,
    PurchaseIntentRequest,
    ResolveGateRequest,
)
from app.payments import service as payments
from app.payments.gateway import (
    build_webhook_event,
    compute_webhook_signature,
    sign_event,
    verify_checkout_signature,
    verify_webhook_signature,
)

from .conftest import HEADPHONES, MOUSE, YOGA_MAT


def approved_intent(token: str, product_id: str = MOUSE):
    return intents.create_intent(
        PurchaseIntentRequest(mandate_token=token, product_id=product_id, qty=1)
    )


# ------------------------------------------------------------- signature math


def test_webhook_signature_roundtrips():
    body = b'{"event":"payment_link.paid"}'
    signature = compute_webhook_signature(body, "a-secret")
    assert verify_webhook_signature(body, signature, "a-secret")


def test_webhook_signature_rejects_a_wrong_secret():
    body = b'{"event":"payment_link.paid"}'
    signature = compute_webhook_signature(body, "a-secret")
    assert not verify_webhook_signature(body, signature, "a-different-secret")


def test_webhook_signature_rejects_a_modified_body():
    """Even a one-byte change to the amount must invalidate the signature."""
    body = b'{"amount":100}'
    signature = compute_webhook_signature(body, "a-secret")
    assert not verify_webhook_signature(b'{"amount":900}', signature, "a-secret")


def test_empty_signature_is_rejected():
    assert not verify_webhook_signature(b"{}", "", "a-secret")


def test_checkout_signature_uses_order_pipe_payment():
    """The browser Checkout fallback signs `order_id|payment_id` with the key secret."""
    import hashlib
    import hmac

    expected = hmac.new(b"key-secret", b"order_1|pay_1", hashlib.sha256).hexdigest()
    assert verify_checkout_signature("order_1", "pay_1", expected, "key-secret")
    assert not verify_checkout_signature("order_1", "pay_2", expected, "key-secret")


# ------------------------------------------------------- approval is required


def test_payment_refuses_a_denied_intent(mandate_token):
    denied = intents.create_intent(
        PurchaseIntentRequest(mandate_token=mandate_token, product_id=YOGA_MAT, qty=1)
    )
    assert denied.intent.status == IntentStatus.DENIED
    with pytest.raises(payments.PaymentError, match="requires an APPROVED intent"):
        payments.start_checkout(intent_id=denied.intent.intent_id, mandate_token=mandate_token)


def test_payment_refuses_a_gated_intent_until_a_human_resolves_it():
    """A gate is not a soft suggestion; the agent cannot pay around it."""
    token = mandates.issue(
        MandateIssueRequest(
            buyer_id="buyer_test",
            merchant_id=get_settings().merchant_id,
            per_txn_cap_paise=900_000,
            total_budget_paise=1_500_000,
            allowed_categories=["electronics"],
            ttl_hours=24,
        )
    ).mandate_token
    gated = approved_intent(token, HEADPHONES)
    assert gated.intent.status == IntentStatus.GATED

    with pytest.raises(payments.PaymentError, match="requires an APPROVED intent"):
        payments.start_checkout(intent_id=gated.intent.intent_id, mandate_token=token)

    intents.resolve_gate(ResolveGateRequest(intent_id=gated.intent.intent_id, approve=True))
    result = payments.start_checkout(intent_id=gated.intent.intent_id, mandate_token=token)
    assert result.checkout_url


def test_a_mandate_cannot_pay_for_another_mandates_intent(mandate_token):
    other = mandates.issue(
        MandateIssueRequest(
            buyer_id="buyer_other",
            merchant_id=get_settings().merchant_id,
            per_txn_cap_paise=300_000,
            total_budget_paise=1_000_000,
            allowed_categories=["electronics"],
            ttl_hours=24,
        )
    ).mandate_token
    mine = approved_intent(mandate_token)
    with pytest.raises(payments.PaymentError, match="only pay for its own intents"):
        payments.start_checkout(intent_id=mine.intent.intent_id, mandate_token=other)


def test_checkout_is_idempotent(mandate_token):
    intent = approved_intent(mandate_token)
    first = payments.start_checkout(intent_id=intent.intent.intent_id, mandate_token=mandate_token)
    second = payments.start_checkout(intent_id=intent.intent.intent_id, mandate_token=mandate_token)
    assert first.payment.rzp_payment_link_id == second.payment.rzp_payment_link_id


# ------------------------------------------------------ settlement via webhook


def test_unsigned_webhook_is_rejected_and_changes_nothing(mandate_token):
    intent = approved_intent(mandate_token)
    payments.start_checkout(intent_id=intent.intent.intent_id, mandate_token=mandate_token)

    body = json.dumps({"event": "payment_link.paid", "payload": {}}).encode()
    with pytest.raises(payments.WebhookRejected):
        payments.handle_webhook(raw_body=body, signature="deadbeef")

    assert intents.get_intent(intent.intent.intent_id).status == IntentStatus.APPROVED


def test_a_client_cannot_claim_payment_without_a_signature(mandate_token):
    """The whole reason PAID lives behind the webhook rather than a client call."""
    intent = approved_intent(mandate_token)
    checkout = payments.start_checkout(
        intent_id=intent.intent.intent_id, mandate_token=mandate_token
    )
    forged = json.dumps(
        build_webhook_event(
            event="payment_link.paid",
            payment_link={"id": checkout.payment.rzp_payment_link_id, "notes": {"intent_id": intent.intent.intent_id}},
            order=None,
            payment=None,
        )
    ).encode()
    with pytest.raises(payments.WebhookRejected):
        payments.handle_webhook(raw_body=forged, signature="00" * 32)
    assert intents.get_intent(intent.intent.intent_id).status != IntentStatus.PAID


def test_verified_webhook_settles_the_purchase(mandate_token):
    intent = approved_intent(mandate_token)
    checkout = payments.start_checkout(
        intent_id=intent.intent.intent_id, mandate_token=mandate_token
    )
    before = mandates.get_record(intent.intent.mandate_id)
    assert before.reserved_paise == intent.intent.amount_paise

    result = payments.simulate_payment(
        payment_link_id=checkout.payment.rzp_payment_link_id, outcome="success"
    )
    assert result["status"] == "paid"

    after = mandates.get_record(intent.intent.mandate_id)
    assert intents.get_intent(intent.intent.intent_id).status == IntentStatus.PAID
    assert after.spent_paise == intent.intent.amount_paise
    assert after.reserved_paise == 0


def test_failed_payment_releases_the_hold_without_spending(mandate_token):
    """A charge that did not succeed must not consume the buyer's budget."""
    intent = approved_intent(mandate_token)
    checkout = payments.start_checkout(
        intent_id=intent.intent.intent_id, mandate_token=mandate_token
    )
    payments.simulate_payment(
        payment_link_id=checkout.payment.rzp_payment_link_id, outcome="failure"
    )

    after = mandates.get_record(intent.intent.mandate_id)
    assert intents.get_intent(intent.intent.intent_id).status == IntentStatus.FAILED
    assert after.spent_paise == 0
    assert after.reserved_paise == 0
    assert after.available_paise == after.total_budget_paise


def test_paid_purchase_decrements_stock(mandate_token):
    from app.catalog import store as catalog

    before = catalog.get_product(MOUSE).stock
    intent = approved_intent(mandate_token)
    checkout = payments.start_checkout(
        intent_id=intent.intent.intent_id, mandate_token=mandate_token
    )
    payments.simulate_payment(
        payment_link_id=checkout.payment.rzp_payment_link_id, outcome="success"
    )
    assert catalog.get_product(MOUSE).stock == before - 1


def test_redelivered_webhook_is_ignored(mandate_token):
    """Razorpay retries. Settling twice would double-count the spend."""
    intent = approved_intent(mandate_token)
    checkout = payments.start_checkout(
        intent_id=intent.intent.intent_id, mandate_token=mandate_token
    )
    event = build_webhook_event(
        event="payment_link.paid",
        payment_link={
            "id": checkout.payment.rzp_payment_link_id,
            "notes": {"intent_id": intent.intent.intent_id},
        },
        order=None,
        payment=None,
    )
    raw, signature = sign_event(event)

    first = payments.handle_webhook(raw_body=raw, signature=signature, event_id="evt_same")
    second = payments.handle_webhook(raw_body=raw, signature=signature, event_id="evt_same")

    assert first["status"] == "paid"
    assert second["status"] == "duplicate"
    assert mandates.get_record(intent.intent.mandate_id).spent_paise == intent.intent.amount_paise


def test_webhook_for_an_unknown_intent_is_accepted_but_does_nothing():
    event = build_webhook_event(
        event="payment_link.paid",
        payment_link={"id": "plink_nothing_here", "notes": {}},
        order=None,
        payment=None,
    )
    raw, signature = sign_event(event)
    result = payments.handle_webhook(raw_body=raw, signature=signature)
    assert result["status"] == "unmatched"


def test_irrelevant_event_types_are_ignored(mandate_token):
    intent = approved_intent(mandate_token)
    checkout = payments.start_checkout(
        intent_id=intent.intent.intent_id, mandate_token=mandate_token
    )
    event = build_webhook_event(
        event="payment.authorized",
        payment_link={
            "id": checkout.payment.rzp_payment_link_id,
            "notes": {"intent_id": intent.intent.intent_id},
        },
        order=None,
        payment=None,
    )
    raw, signature = sign_event(event)
    result = payments.handle_webhook(raw_body=raw, signature=signature)
    assert result["status"] == "ignored"
    assert intents.get_intent(intent.intent.intent_id).status == IntentStatus.APPROVED
