"""Append-only, hash-chained audit trail.

Every money-relevant event -- an intent being raised, each guardrail decision, a
Razorpay order, a verified webhook, a human approving a gated purchase -- lands
here before anything else happens.

The chain: `hash_n = sha256(hash_{n-1} + canonical_json(body_n))`. Editing any
historical row changes its hash, which invalidates every hash after it, which
`verify_chain()` reports with the exact sequence number where the break starts.
Deliberately lightweight -- this is tamper *evidence*, not a blockchain.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from typing import Any

from ..db import connect
from ..models import AuditChainVerification, AuditEvent, iso, utcnow
from .broadcaster import broadcaster

GENESIS_HASH = "0" * 64


def canonical_json(value: Any) -> str:
    """Byte-stable JSON: sorted keys, no incidental whitespace, unicode preserved.

    The hash is taken over this exact encoding, so it must never depend on dict
    ordering or on the Python version that happened to write the row.
    """
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _chain_body(
    *,
    event_id: str,
    ts: str,
    actor: str,
    event_type: str,
    intent_id: str | None,
    mandate_id: str | None,
    amount_paise: int | None,
    decision: str | None,
    summary: str,
    reasons: list[str],
    payload: dict[str, Any],
) -> dict[str, Any]:
    return {
        "event_id": event_id,
        "ts": ts,
        "actor": actor,
        "event_type": event_type,
        "intent_id": intent_id,
        "mandate_id": mandate_id,
        "amount_paise": amount_paise,
        "decision": decision,
        "summary": summary,
        "reasons": reasons,
        "payload": payload,
    }


def compute_hash(prev_hash: str, body: dict[str, Any]) -> str:
    return hashlib.sha256((prev_hash + canonical_json(body)).encode("utf-8")).hexdigest()


def _row_to_event(row: sqlite3.Row) -> AuditEvent:
    return AuditEvent(
        seq=row["seq"],
        event_id=row["event_id"],
        ts=row["ts"],
        actor=row["actor"],
        event_type=row["event_type"],
        intent_id=row["intent_id"],
        mandate_id=row["mandate_id"],
        amount_paise=row["amount_paise"],
        decision=row["decision"],
        summary=row["summary"],
        reasons=json.loads(row["reasons_json"]),
        payload=json.loads(row["payload_json"]),
        prev_hash=row["prev_hash"],
        hash=row["hash"],
    )


def record(
    *,
    actor: str,
    event_type: str,
    summary: str,
    intent_id: str | None = None,
    mandate_id: str | None = None,
    amount_paise: int | None = None,
    decision: str | None = None,
    reasons: list[str] | None = None,
    payload: dict[str, Any] | None = None,
    conn: sqlite3.Connection | None = None,
) -> AuditEvent:
    """Append one event and stream it to the dashboard.

    Pass `conn` to enlist in a caller's open transaction, so that a budget
    mutation and its audit row commit or roll back together.
    """
    reasons = reasons or []
    payload = payload or {}
    event_id = f"evt_{uuid.uuid4().hex[:20]}"
    ts = iso(utcnow())

    def _write(c: sqlite3.Connection) -> AuditEvent:
        head = c.execute("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1").fetchone()
        prev_hash = head["hash"] if head else GENESIS_HASH
        body = _chain_body(
            event_id=event_id,
            ts=ts,
            actor=actor,
            event_type=event_type,
            intent_id=intent_id,
            mandate_id=mandate_id,
            amount_paise=amount_paise,
            decision=decision,
            summary=summary,
            reasons=reasons,
            payload=payload,
        )
        digest = compute_hash(prev_hash, body)
        cursor = c.execute(
            """
            INSERT INTO audit_log (
                event_id, ts, actor, event_type, intent_id, mandate_id,
                amount_paise, decision, summary, reasons_json, payload_json,
                prev_hash, hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                ts,
                actor,
                event_type,
                intent_id,
                mandate_id,
                amount_paise,
                decision,
                summary,
                canonical_json(reasons),
                canonical_json(payload),
                prev_hash,
                digest,
            ),
        )
        return AuditEvent(
            seq=int(cursor.lastrowid or 0),
            event_id=event_id,
            ts=ts,
            actor=actor,
            event_type=event_type,
            intent_id=intent_id,
            mandate_id=mandate_id,
            amount_paise=amount_paise,
            decision=decision,
            summary=summary,
            reasons=reasons,
            payload=payload,
            prev_hash=prev_hash,
            hash=digest,
        )

    if conn is not None:
        event = _write(conn)
    else:
        with connect() as own_conn:
            event = _write(own_conn)

    broadcaster.publish(event.model_dump())
    return event


def list_events(
    *,
    limit: int = 100,
    offset: int = 0,
    intent_id: str | None = None,
    mandate_id: str | None = None,
    since_seq: int | None = None,
) -> list[AuditEvent]:
    clauses: list[str] = []
    params: list[Any] = []
    if intent_id:
        clauses.append("intent_id = ?")
        params.append(intent_id)
    if mandate_id:
        clauses.append("mandate_id = ?")
        params.append(mandate_id)
    if since_seq is not None:
        clauses.append("seq > ?")
        params.append(since_seq)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.extend([limit, offset])
    with connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM audit_log {where} ORDER BY seq DESC LIMIT ? OFFSET ?", params
        ).fetchall()
    return [_row_to_event(row) for row in rows]


def count_events() -> int:
    with connect() as conn:
        return int(conn.execute("SELECT COUNT(*) AS n FROM audit_log").fetchone()["n"])


def verify_chain() -> AuditChainVerification:
    """Recompute every hash from genesis and report the first sequence that diverges."""
    with connect() as conn:
        rows = conn.execute("SELECT * FROM audit_log ORDER BY seq ASC").fetchall()

    prev_hash = GENESIS_HASH
    for row in rows:
        body = _chain_body(
            event_id=row["event_id"],
            ts=row["ts"],
            actor=row["actor"],
            event_type=row["event_type"],
            intent_id=row["intent_id"],
            mandate_id=row["mandate_id"],
            amount_paise=row["amount_paise"],
            decision=row["decision"],
            summary=row["summary"],
            reasons=json.loads(row["reasons_json"]),
            payload=json.loads(row["payload_json"]),
        )
        if row["prev_hash"] != prev_hash:
            return AuditChainVerification(
                valid=False,
                length=len(rows),
                head_hash=rows[-1]["hash"],
                broken_at_seq=row["seq"],
                detail=(
                    f"Row {row['seq']} points at prev_hash {row['prev_hash'][:12]}... "
                    f"but the row before it hashes to {prev_hash[:12]}..."
                ),
            )
        expected = compute_hash(prev_hash, body)
        if expected != row["hash"]:
            return AuditChainVerification(
                valid=False,
                length=len(rows),
                head_hash=rows[-1]["hash"],
                broken_at_seq=row["seq"],
                detail=(
                    f"Row {row['seq']} content does not match its stored hash: "
                    f"expected {expected[:12]}..., stored {row['hash'][:12]}..."
                ),
            )
        prev_hash = row["hash"]

    return AuditChainVerification(
        valid=True,
        length=len(rows),
        head_hash=prev_hash if rows else None,
        detail=(
            f"All {len(rows)} entries hash-chain cleanly from genesis."
            if rows
            else "Audit log is empty; chain is trivially valid."
        ),
    )
