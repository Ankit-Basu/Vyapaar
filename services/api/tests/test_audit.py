"""The audit trail: hash chaining, tamper evidence, and append-only enforcement."""

from __future__ import annotations

import sqlite3

import pytest

from app.audit import log as audit
from app.db import _database_file, connect
from app.intents import service as intents
from app.models import PurchaseIntentRequest

from .conftest import MOUSE, YOGA_MAT


def test_empty_chain_is_valid():
    result = audit.verify_chain()
    assert result.valid
    assert result.length == 0


def test_first_row_chains_from_genesis():
    event = audit.record(actor="test", event_type="test.event", summary="first")
    assert event.prev_hash == audit.GENESIS_HASH
    assert len(event.hash) == 64


def test_each_row_links_to_the_one_before():
    first = audit.record(actor="test", event_type="test.a", summary="a")
    second = audit.record(actor="test", event_type="test.b", summary="b")
    third = audit.record(actor="test", event_type="test.c", summary="c")

    assert second.prev_hash == first.hash
    assert third.prev_hash == second.hash
    assert audit.verify_chain().valid


def test_hashing_is_deterministic():
    """The same content must hash the same way on any machine or Python version."""
    body = {"z": 1, "a": {"nested": [1, 2, 3]}, "m": "text"}
    reordered = {"m": "text", "a": {"nested": [1, 2, 3]}, "z": 1}
    assert audit.compute_hash("prev", body) == audit.compute_hash("prev", reordered)


def test_canonical_json_sorts_keys_and_strips_whitespace():
    assert audit.canonical_json({"b": 1, "a": 2}) == '{"a":2,"b":1}'


def test_update_is_blocked_by_the_database_itself():
    """Append-only is enforced by a trigger, not merely by application convention."""
    audit.record(actor="test", event_type="test.event", summary="original")
    with connect() as conn, pytest.raises(sqlite3.IntegrityError, match="append-only"):
        conn.execute("UPDATE audit_log SET summary = 'tampered' WHERE seq = 1")


def test_delete_is_blocked_by_the_database_itself():
    audit.record(actor="test", event_type="test.event", summary="original")
    with connect() as conn, pytest.raises(sqlite3.IntegrityError, match="append-only"):
        conn.execute("DELETE FROM audit_log WHERE seq = 1")


def test_tampering_around_the_triggers_is_still_detected():
    """Drop the trigger and edit a row directly: verify_chain names the exact break."""
    for i in range(4):
        audit.record(actor="test", event_type="test.event", summary=f"row {i}", amount_paise=i * 100)
    assert audit.verify_chain().valid

    raw = sqlite3.connect(_database_file())
    raw.execute("DROP TRIGGER audit_log_block_update")
    raw.execute("UPDATE audit_log SET amount_paise = 999999 WHERE seq = 2")
    raw.commit()
    raw.close()

    result = audit.verify_chain()
    assert not result.valid
    assert result.broken_at_seq == 2
    assert "does not match its stored hash" in result.detail


def test_a_money_decision_lands_in_the_trail(mandate_token):
    intents.create_intent(PurchaseIntentRequest(mandate_token=mandate_token, product_id=MOUSE, qty=1))
    types = [e.event_type for e in audit.list_events(limit=50)]
    assert "mandate.issued" in types
    assert "intent.created" in types
    assert "policy.decision" in types


def test_a_denial_records_its_reason(mandate_token):
    intents.create_intent(
        PurchaseIntentRequest(mandate_token=mandate_token, product_id=YOGA_MAT, qty=1)
    )
    decision_event = next(
        e for e in audit.list_events(limit=50) if e.event_type == "policy.decision"
    )
    assert decision_event.decision == "deny"
    assert "fitness" in decision_event.reasons[0]
    # Every check, including the skipped ones, is preserved for replay.
    assert len(decision_event.payload["checks"]) == 8


def test_events_can_be_filtered_by_intent(mandate_token):
    a = intents.create_intent(
        PurchaseIntentRequest(mandate_token=mandate_token, product_id=MOUSE, qty=1)
    )
    b = intents.create_intent(
        PurchaseIntentRequest(mandate_token=mandate_token, product_id=YOGA_MAT, qty=1)
    )
    only_a = audit.list_events(intent_id=a.intent.intent_id, limit=50)
    assert only_a
    assert all(e.intent_id == a.intent.intent_id for e in only_a)
    assert b.intent.intent_id not in {e.intent_id for e in only_a}


def test_a_rejected_webhook_is_itself_audited():
    """A failed authentication attempt is exactly what an audit trail is for."""
    from app.payments import service as payments

    with pytest.raises(payments.WebhookRejected):
        payments.handle_webhook(raw_body=b'{"event":"payment_link.paid"}', signature="bogus")

    assert any(e.event_type == "payment.webhook_rejected" for e in audit.list_events(limit=20))


def test_chain_survives_a_long_run_of_events():
    for i in range(60):
        audit.record(actor="test", event_type="bulk", summary=f"event {i}", amount_paise=i)
    result = audit.verify_chain()
    assert result.valid
    assert result.length == 60
    assert audit.count_events() == 60
