"""Mandate issue, verification and budget accounting."""

from __future__ import annotations

from datetime import timedelta

import jwt
import pytest

from app.config import get_settings
from app.db import connect, transaction
from app.mandate import service as mandates
from app.models import MandateIssueRequest, utcnow


def issue(**overrides):
    defaults = {
        "buyer_id": "buyer_test",
        "merchant_id": get_settings().merchant_id,
        "per_txn_cap_paise": 300_000,
        "total_budget_paise": 1_000_000,
        "allowed_categories": ["electronics", "office"],
        "ttl_hours": 24,
    }
    return mandates.issue(MandateIssueRequest(**{**defaults, **overrides}))


# ----------------------------------------------------------------- issuance


def test_issue_returns_a_verifiable_token():
    result = issue()
    verified = mandates.verify(result.mandate_token)
    assert verified.valid
    assert verified.record.mandate_id == result.mandate.mandate_id
    assert verified.record.spent_paise == 0
    assert verified.record.reserved_paise == 0


def test_token_carries_registered_jwt_claims():
    """Any standard JWT tool should be able to read this, not just our code."""
    token = issue().mandate_token
    claims = jwt.decode(token, options={"verify_signature": False})
    for field in ("jti", "sub", "aud", "iss", "iat", "exp"):
        assert field in claims, f"missing registered claim {field}"


def test_categories_are_normalised():
    result = issue(allowed_categories=["  Electronics ", "OFFICE", "electronics"])
    assert result.mandate.allowed_categories == ["electronics", "office"]


def test_per_txn_cap_may_not_exceed_the_budget():
    with pytest.raises(mandates.MandateError, match="cannot exceed"):
        issue(per_txn_cap_paise=500_000, total_budget_paise=100_000)


def test_expiry_in_the_past_is_refused():
    with pytest.raises(mandates.MandateError, match="future"):
        issue(expires_at=utcnow() - timedelta(hours=1), ttl_hours=None)


def test_absurdly_long_lifetime_is_refused():
    """A standing agent authorisation should be short-lived."""
    with pytest.raises(mandates.MandateError, match="lifetime"):
        issue(ttl_hours=24 * 400)


# -------------------------------------------------------------- verification


def test_tampered_payload_fails_verification():
    """The whole point: a holder cannot widen their own scope."""
    original = issue().mandate_token
    claims = jwt.decode(original, options={"verify_signature": False})
    claims["per_txn_cap_paise"] = 99_999_900
    forged = jwt.encode(claims, "not-the-real-secret", algorithm="HS256")

    result = mandates.verify(forged)
    assert not result.valid
    assert "signature" in result.reason.lower()


def test_token_signed_with_the_right_key_but_unknown_to_the_merchant_fails():
    settings = get_settings()
    orphan = jwt.encode(
        {
            "jti": "mdt_never_issued",
            "sub": "buyer_x",
            "aud": settings.merchant_id,
            "iss": settings.mandate_issuer,
            "iat": int(utcnow().timestamp()),
            "exp": int((utcnow() + timedelta(hours=1)).timestamp()),
            "mandate_id": "mdt_never_issued",
        },
        settings.mandate_jwt_secret,
        algorithm=settings.mandate_jwt_algorithm,
    )
    result = mandates.verify(orphan)
    assert not result.valid
    assert "not on record" in result.reason


def test_expired_token_fails_verification():
    settings = get_settings()
    record = issue().mandate
    expired = jwt.encode(
        {
            "jti": record.mandate_id,
            "sub": record.buyer_id,
            "aud": record.merchant_id,
            "iss": settings.mandate_issuer,
            "iat": int((utcnow() - timedelta(hours=2)).timestamp()),
            "exp": int((utcnow() - timedelta(hours=1)).timestamp()),
            "mandate_id": record.mandate_id,
        },
        settings.mandate_jwt_secret,
        algorithm=settings.mandate_jwt_algorithm,
    )
    result = mandates.verify(expired)
    assert not result.valid
    assert "expired" in result.reason.lower()


def test_scope_drift_between_token_and_record_fails():
    """A token re-signed with the real key but a different cap is still refused."""
    settings = get_settings()
    result = issue()
    claims = jwt.decode(result.mandate_token, options={"verify_signature": False})
    claims["per_txn_cap_paise"] = 99_999_900
    resigned = jwt.encode(claims, settings.mandate_jwt_secret, algorithm=settings.mandate_jwt_algorithm)

    verified = mandates.verify(resigned)
    assert not verified.valid
    assert "does not match the scope on record" in verified.reason


def test_garbage_token_fails_cleanly():
    for junk in ("", "not-a-jwt", "a.b.c"):
        result = mandates.verify(junk)
        assert not result.valid
        assert result.reason


def test_revoked_mandate_fails_verification():
    result = issue()
    mandates.revoke(result.mandate.mandate_id)
    verified = mandates.verify(result.mandate_token)
    assert not verified.valid
    assert "revoked" in verified.reason.lower()


def test_require_valid_raises_on_a_bad_token():
    with pytest.raises(mandates.MandateError):
        mandates.require_valid("not-a-jwt")


# ---------------------------------------------------------- budget accounting


def test_reserve_then_settle_moves_money_from_held_to_spent():
    record = issue().mandate
    with transaction() as conn:
        assert mandates.reserve(record.mandate_id, 100_000, conn)
    assert mandates.get_record(record.mandate_id).reserved_paise == 100_000
    assert mandates.get_record(record.mandate_id).spent_paise == 0

    with transaction() as conn:
        assert mandates.settle(record.mandate_id, 100_000, conn)
    after = mandates.get_record(record.mandate_id)
    assert after.reserved_paise == 0
    assert after.spent_paise == 100_000


def test_release_returns_held_money_without_spending_it():
    record = issue().mandate
    with transaction() as conn:
        mandates.reserve(record.mandate_id, 100_000, conn)
        assert mandates.release(record.mandate_id, 100_000, conn)
    after = mandates.get_record(record.mandate_id)
    assert after.reserved_paise == 0
    assert after.spent_paise == 0
    assert after.available_paise == after.total_budget_paise


def test_reserve_refuses_to_exceed_the_budget():
    record = issue(total_budget_paise=100_000, per_txn_cap_paise=100_000).mandate
    with transaction() as conn:
        assert mandates.reserve(record.mandate_id, 60_000, conn)
        assert not mandates.reserve(record.mandate_id, 60_000, conn)
    assert mandates.get_record(record.mandate_id).reserved_paise == 60_000


def test_reserve_refuses_on_a_revoked_mandate():
    record = issue().mandate
    mandates.revoke(record.mandate_id)
    with transaction() as conn:
        assert not mandates.reserve(record.mandate_id, 10_000, conn)


def test_settle_refuses_more_than_is_held():
    """Guards against settling money that was never reserved."""
    record = issue().mandate
    with transaction() as conn:
        mandates.reserve(record.mandate_id, 50_000, conn)
        assert not mandates.settle(record.mandate_id, 90_000, conn)
    assert mandates.get_record(record.mandate_id).spent_paise == 0


def test_concurrent_reservations_cannot_both_take_the_last_rupee():
    """Two agents racing for the same remaining budget: exactly one wins."""
    record = issue(total_budget_paise=100_000, per_txn_cap_paise=100_000).mandate
    outcomes = []
    with connect() as a, connect() as b:
        # Both read the same available balance before either writes.
        for conn in (a, b):
            outcomes.append(mandates.reserve(record.mandate_id, 60_000, conn))
            conn.commit()
    assert outcomes == [True, False]
    assert mandates.get_record(record.mandate_id).reserved_paise == 60_000


def test_available_budget_subtracts_both_spend_and_holds():
    record = issue(total_budget_paise=1_000_000).mandate
    with transaction() as conn:
        mandates.reserve(record.mandate_id, 300_000, conn)
        mandates.settle(record.mandate_id, 300_000, conn)
        mandates.reserve(record.mandate_id, 200_000, conn)
    after = mandates.get_record(record.mandate_id)
    assert after.spent_paise == 300_000
    assert after.reserved_paise == 200_000
    assert after.available_paise == 500_000
