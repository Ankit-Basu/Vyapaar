"""Signed mandates: the consent artefact an agent presents to spend money.

Shape borrowed from AP2 (a signed token encoding scope, caps and expiry) and from
NPCI's Unified Agent Protocol pattern (one-time human consent plus per-merchant
spending limits, so the agent transacts without a PIN or OTP each time). UAP is
not live yet, so this is our own signed mandate rather than a dependency on it.

Two rules the rest of the system leans on:

1. The token is *scope*, never *state*. Caps, merchant and categories are signed
   into it; how much has actually been spent is server-side only. A client that
   edits its own "remaining budget" changes nothing.
2. Committed money is reserved before a payment starts and only converted to
   spend when a verified webhook confirms it. A failed payment releases the hold,
   so the budget is never silently consumed by a charge that did not happen.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from ..config import get_settings
from ..db import connect, transaction
from ..models import (
    MandateClaims,
    MandateIssueRequest,
    MandateIssueResponse,
    MandateRecord,
    MandateVerifyResponse,
    iso,
    utcnow,
)

log = logging.getLogger("agentmandi.mandate")


class MandateError(Exception):
    """Raised when a mandate cannot be used. The message is safe to surface."""


def _row_to_record(row: sqlite3.Row) -> MandateRecord:
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


def _claims_from_record(record: MandateRecord) -> MandateClaims:
    return MandateClaims(
        mandate_id=record.mandate_id,
        buyer_id=record.buyer_id,
        merchant_id=record.merchant_id,
        per_txn_cap_paise=record.per_txn_cap_paise,
        total_budget_paise=record.total_budget_paise,
        allowed_categories=record.allowed_categories,
        issued_at=record.issued_at,
        expires_at=record.expires_at,
        issuer=get_settings().mandate_issuer,
    )


def _encode(record: MandateRecord) -> str:
    settings = get_settings()
    issued = datetime.fromisoformat(record.issued_at.replace("Z", "+00:00"))
    expires = datetime.fromisoformat(record.expires_at.replace("Z", "+00:00"))
    payload: dict[str, Any] = {
        # registered claims, so any standard JWT tool can read this
        "jti": record.mandate_id,
        "sub": record.buyer_id,
        "aud": record.merchant_id,
        "iss": settings.mandate_issuer,
        "iat": int(issued.timestamp()),
        "exp": int(expires.timestamp()),
        # the mandate scope itself
        "mandate_id": record.mandate_id,
        "buyer_id": record.buyer_id,
        "merchant_id": record.merchant_id,
        "per_txn_cap_paise": record.per_txn_cap_paise,
        "total_budget_paise": record.total_budget_paise,
        "allowed_categories": record.allowed_categories,
        "issued_at": record.issued_at,
        "expires_at": record.expires_at,
    }
    return jwt.encode(payload, settings.mandate_jwt_secret, algorithm=settings.mandate_jwt_algorithm)


def issue(request: MandateIssueRequest) -> MandateIssueResponse:
    settings = get_settings()
    now = utcnow()

    if request.expires_at is not None:
        expires = request.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
    else:
        expires = now + timedelta(hours=request.ttl_hours or 24)

    if expires <= now:
        raise MandateError("expires_at must be in the future")
    max_expiry = now + timedelta(hours=settings.mandate_max_ttl_hours)
    if expires > max_expiry:
        raise MandateError(
            f"mandate lifetime exceeds the {settings.mandate_max_ttl_hours}h ceiling; "
            "a standing agent authorisation should be short-lived"
        )
    if request.per_txn_cap_paise > request.total_budget_paise:
        raise MandateError(
            "per_txn_cap_paise cannot exceed total_budget_paise; the per-transaction "
            "cap must sit inside the overall budget"
        )

    record = MandateRecord(
        mandate_id=f"mdt_{uuid.uuid4().hex[:20]}",
        buyer_id=request.buyer_id,
        merchant_id=request.merchant_id,
        per_txn_cap_paise=request.per_txn_cap_paise,
        total_budget_paise=request.total_budget_paise,
        spent_paise=0,
        reserved_paise=0,
        allowed_categories=request.allowed_categories,
        issued_at=iso(now),
        expires_at=iso(expires),
        revoked_at=None,
        label=request.label,
    )

    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO mandate (mandate_id, buyer_id, merchant_id, per_txn_cap_paise,
                                 total_budget_paise, spent_paise, reserved_paise,
                                 allowed_categories_json, issued_at, expires_at, revoked_at, label)
            VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, NULL, ?)
            """,
            (
                record.mandate_id,
                record.buyer_id,
                record.merchant_id,
                record.per_txn_cap_paise,
                record.total_budget_paise,
                json.dumps(record.allowed_categories),
                record.issued_at,
                record.expires_at,
                record.label,
            ),
        )
        from ..audit import log as audit  # noqa: PLC0415 - avoids an import cycle

        audit.record(
            conn=conn,
            actor="merchant",
            event_type="mandate.issued",
            mandate_id=record.mandate_id,
            amount_paise=record.total_budget_paise,
            summary=(
                f"Mandate issued to {record.buyer_id}: budget {record.total_budget_paise / 100:,.2f} INR, "
                f"per-transaction cap {record.per_txn_cap_paise / 100:,.2f} INR, "
                f"categories {record.allowed_categories}, expires {record.expires_at}"
            ),
            reasons=[
                "Human granted a bounded, time-limited spending authorisation to an agent.",
                f"Scope is enforced server-side on every intent, not by the token holder.",
            ],
            payload=record.model_dump(),
        )

    log.info("issued mandate %s for buyer %s", record.mandate_id, record.buyer_id)
    return MandateIssueResponse(
        mandate_token=_encode(record), mandate=record, claims=_claims_from_record(record)
    )


def get_record(mandate_id: str) -> MandateRecord | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM mandate WHERE mandate_id = ?", (mandate_id,)).fetchone()
    return _row_to_record(row) if row else None


def list_mandates(limit: int = 50) -> list[MandateRecord]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM mandate ORDER BY issued_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_row_to_record(row) for row in rows]


def verify(mandate_token: str) -> MandateVerifyResponse:
    """Validate signature, expiry, issuer and revocation. Never raises on bad input."""
    settings = get_settings()
    try:
        decoded = jwt.decode(
            mandate_token,
            settings.mandate_jwt_secret,
            algorithms=[settings.mandate_jwt_algorithm],
            issuer=settings.mandate_issuer,
            options={"verify_aud": False, "require": ["exp", "iat", "iss", "jti"]},
        )
    except jwt.ExpiredSignatureError:
        return MandateVerifyResponse(valid=False, reason="Mandate has expired.")
    except jwt.InvalidIssuerError:
        return MandateVerifyResponse(valid=False, reason="Mandate was issued by an unknown issuer.")
    except jwt.InvalidSignatureError:
        return MandateVerifyResponse(
            valid=False, reason="Mandate signature does not verify; the token was altered or forged."
        )
    except jwt.InvalidTokenError as exc:
        return MandateVerifyResponse(valid=False, reason=f"Mandate token is malformed: {exc}")

    record = get_record(decoded.get("mandate_id", ""))
    if record is None:
        return MandateVerifyResponse(
            valid=False,
            reason="Mandate signature is valid but the mandate is not on record with this merchant.",
        )
    if record.revoked_at is not None:
        return MandateVerifyResponse(
            valid=False, reason=f"Mandate was revoked at {record.revoked_at}."
        )

    # The token is scope; the record is truth. If they disagree, refuse.
    signed_scope = {
        "buyer_id": decoded.get("buyer_id"),
        "merchant_id": decoded.get("merchant_id"),
        "per_txn_cap_paise": decoded.get("per_txn_cap_paise"),
        "total_budget_paise": decoded.get("total_budget_paise"),
        "allowed_categories": decoded.get("allowed_categories"),
    }
    stored_scope = {
        "buyer_id": record.buyer_id,
        "merchant_id": record.merchant_id,
        "per_txn_cap_paise": record.per_txn_cap_paise,
        "total_budget_paise": record.total_budget_paise,
        "allowed_categories": record.allowed_categories,
    }
    if signed_scope != stored_scope:
        return MandateVerifyResponse(
            valid=False,
            reason="Mandate scope in the token does not match the scope on record with the merchant.",
        )

    return MandateVerifyResponse(
        valid=True,
        reason="Signature, issuer, expiry and merchant record all check out.",
        claims=_claims_from_record(record),
        record=record,
    )


def require_valid(mandate_token: str) -> MandateRecord:
    result = verify(mandate_token)
    if not result.valid or result.record is None:
        raise MandateError(result.reason)
    return result.record


def revoke(mandate_id: str) -> MandateRecord | None:
    with transaction() as conn:
        conn.execute(
            "UPDATE mandate SET revoked_at = ? WHERE mandate_id = ? AND revoked_at IS NULL",
            (iso(utcnow()), mandate_id),
        )
    return get_record(mandate_id)


# --------------------------------------------------------------------------
# Budget accounting: reserve -> settle | release
# --------------------------------------------------------------------------


def reserve(mandate_id: str, amount_paise: int, conn: sqlite3.Connection) -> bool:
    """Place a hold on budget. Returns False when the mandate cannot cover it.

    The availability test lives in the WHERE clause on purpose: two agents racing
    for the last rupee both run this UPDATE, and SQLite guarantees only one of
    them sees a row change.
    """
    cursor = conn.execute(
        """
        UPDATE mandate
           SET reserved_paise = reserved_paise + ?
         WHERE mandate_id = ?
           AND revoked_at IS NULL
           AND (total_budget_paise - spent_paise - reserved_paise) >= ?
        """,
        (amount_paise, mandate_id, amount_paise),
    )
    return cursor.rowcount > 0


def settle(mandate_id: str, amount_paise: int, conn: sqlite3.Connection) -> bool:
    """Convert a hold into settled spend. Called only from a verified payment webhook."""
    cursor = conn.execute(
        """
        UPDATE mandate
           SET reserved_paise = reserved_paise - ?,
               spent_paise    = spent_paise + ?
         WHERE mandate_id = ? AND reserved_paise >= ?
        """,
        (amount_paise, amount_paise, mandate_id, amount_paise),
    )
    return cursor.rowcount > 0


def release(mandate_id: str, amount_paise: int, conn: sqlite3.Connection) -> bool:
    """Drop a hold without spending. Used when a payment fails or an intent is abandoned."""
    cursor = conn.execute(
        """
        UPDATE mandate
           SET reserved_paise = reserved_paise - ?
         WHERE mandate_id = ? AND reserved_paise >= ?
        """,
        (amount_paise, mandate_id, amount_paise),
    )
    return cursor.rowcount > 0
