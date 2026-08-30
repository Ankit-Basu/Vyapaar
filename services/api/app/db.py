"""SQLite persistence.

Chosen over a hosted Postgres for the demo because it has no network dependency,
no free-tier cold start, and it makes the run reproducible on any machine. The
schema is deliberately plain SQL so a judge can read exactly what is stored.

Two properties worth calling out:

* `audit_log` is append-only *at the database level* -- UPDATE and DELETE are
  blocked by triggers, not merely by convention in application code.
* Budget mutations run inside `BEGIN IMMEDIATE` transactions so two concurrent
  agents cannot both spend the last rupee of a mandate.
"""

from __future__ import annotations

import contextlib
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS product (
    id                TEXT PRIMARY KEY,
    title             TEXT    NOT NULL,
    description       TEXT    NOT NULL,
    category          TEXT    NOT NULL,
    price_paise       INTEGER NOT NULL CHECK (price_paise >= 0),
    currency          TEXT    NOT NULL DEFAULT 'INR',
    stock             INTEGER NOT NULL CHECK (stock >= 0),
    attributes_json   TEXT    NOT NULL DEFAULT '{}',
    search_text       TEXT    NOT NULL DEFAULT '',
    embedding         BLOB
);
CREATE INDEX IF NOT EXISTS idx_product_category ON product(category);
CREATE INDEX IF NOT EXISTS idx_product_price    ON product(price_paise);

CREATE TABLE IF NOT EXISTS mandate (
    mandate_id              TEXT PRIMARY KEY,
    buyer_id                TEXT    NOT NULL,
    merchant_id             TEXT    NOT NULL,
    per_txn_cap_paise       INTEGER NOT NULL CHECK (per_txn_cap_paise > 0),
    total_budget_paise      INTEGER NOT NULL CHECK (total_budget_paise > 0),
    spent_paise             INTEGER NOT NULL DEFAULT 0 CHECK (spent_paise >= 0),
    reserved_paise          INTEGER NOT NULL DEFAULT 0 CHECK (reserved_paise >= 0),
    allowed_categories_json TEXT    NOT NULL,
    issued_at               TEXT    NOT NULL,
    expires_at              TEXT    NOT NULL,
    revoked_at              TEXT,
    label                   TEXT
);
CREATE INDEX IF NOT EXISTS idx_mandate_buyer ON mandate(buyer_id);

CREATE TABLE IF NOT EXISTS purchase_intent (
    intent_id         TEXT PRIMARY KEY,
    mandate_id        TEXT    NOT NULL REFERENCES mandate(mandate_id),
    buyer_id          TEXT    NOT NULL,
    merchant_id       TEXT    NOT NULL,
    product_id        TEXT    NOT NULL,
    product_title     TEXT    NOT NULL,
    category          TEXT    NOT NULL,
    unit_price_paise  INTEGER NOT NULL,
    qty               INTEGER NOT NULL CHECK (qty > 0),
    amount_paise      INTEGER NOT NULL CHECK (amount_paise >= 0),
    status            TEXT    NOT NULL,
    agent_rationale   TEXT,
    reserved_paise    INTEGER NOT NULL DEFAULT 0,
    idempotency_key   TEXT,
    decision_json     TEXT,
    offer_id          TEXT,
    list_amount_paise INTEGER NOT NULL DEFAULT 0,
    discount_paise    INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL,
    updated_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intent_mandate ON purchase_intent(mandate_id);
CREATE INDEX IF NOT EXISTS idx_intent_status  ON purchase_intent(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intent_idem
    ON purchase_intent(mandate_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment (
    payment_id           TEXT PRIMARY KEY,
    intent_id            TEXT    NOT NULL REFERENCES purchase_intent(intent_id),
    rzp_order_id         TEXT,
    rzp_payment_link_id  TEXT,
    rzp_payment_id       TEXT,
    short_url            TEXT,
    amount_paise         INTEGER NOT NULL,
    status               TEXT    NOT NULL,
    mode                 TEXT    NOT NULL,
    failure_reason       TEXT,
    raw_json             TEXT    NOT NULL DEFAULT '{}',
    created_at           TEXT    NOT NULL,
    updated_at           TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_intent ON payment(intent_id);
CREATE INDEX IF NOT EXISTS idx_payment_order  ON payment(rzp_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_link   ON payment(rzp_payment_link_id);

CREATE TABLE IF NOT EXISTS webhook_event (
    id               TEXT PRIMARY KEY,
    received_at      TEXT    NOT NULL,
    event_type       TEXT    NOT NULL,
    signature_valid  INTEGER NOT NULL,
    handled          INTEGER NOT NULL DEFAULT 0,
    raw_json         TEXT    NOT NULL
);

-- Merchant-private unit economics. Deliberately a separate table from `product`:
-- cost price must never leak into the agent-facing catalog feed, and keeping it
-- out of the Product model makes that a structural guarantee rather than a habit.
CREATE TABLE IF NOT EXISTS product_economics (
    product_id   TEXT PRIMARY KEY REFERENCES product(id),
    cost_paise   INTEGER NOT NULL CHECK (cost_paise >= 0),
    updated_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign (
    campaign_id              TEXT PRIMARY KEY,
    name                     TEXT    NOT NULL,
    merchant_id              TEXT    NOT NULL,
    status                   TEXT    NOT NULL DEFAULT 'ACTIVE',
    discount_budget_paise    INTEGER NOT NULL CHECK (discount_budget_paise > 0),
    discount_spent_paise     INTEGER NOT NULL DEFAULT 0 CHECK (discount_spent_paise >= 0),
    discount_reserved_paise  INTEGER NOT NULL DEFAULT 0 CHECK (discount_reserved_paise >= 0),
    max_discount_bps         INTEGER NOT NULL CHECK (max_discount_bps > 0),
    floor_margin_bps         INTEGER NOT NULL CHECK (floor_margin_bps >= 0),
    deep_discount_gate_paise INTEGER NOT NULL CHECK (deep_discount_gate_paise > 0),
    allowed_categories_json  TEXT    NOT NULL DEFAULT '[]',
    suppressed_json          TEXT    NOT NULL DEFAULT '[]',
    created_at               TEXT    NOT NULL,
    updated_at               TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS offer (
    offer_id           TEXT PRIMARY KEY,
    campaign_id        TEXT    NOT NULL REFERENCES campaign(campaign_id),
    kind               TEXT    NOT NULL,
    anchor_product_id  TEXT    NOT NULL,
    lines_json         TEXT    NOT NULL DEFAULT '[]',
    list_total_paise   INTEGER NOT NULL,
    offer_total_paise  INTEGER NOT NULL,
    discount_paise     INTEGER NOT NULL,
    discount_bps       INTEGER NOT NULL,
    baseline_paise     INTEGER NOT NULL DEFAULT 0,
    margin_paise       INTEGER NOT NULL DEFAULT 0,
    headline           TEXT    NOT NULL DEFAULT '',
    rationale          TEXT    NOT NULL DEFAULT '',
    disclosure         TEXT    NOT NULL DEFAULT '',
    status             TEXT    NOT NULL,
    decision_json      TEXT    NOT NULL DEFAULT '{}',
    intent_id          TEXT,
    buyer_id           TEXT,
    reserved_paise     INTEGER NOT NULL DEFAULT 0,
    expires_at         TEXT    NOT NULL,
    created_at         TEXT    NOT NULL,
    updated_at         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offer_campaign ON offer(campaign_id);
CREATE INDEX IF NOT EXISTS idx_offer_status   ON offer(status);
CREATE INDEX IF NOT EXISTS idx_offer_intent   ON offer(intent_id);

CREATE TABLE IF NOT EXISTS audit_log (
    seq           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id      TEXT    NOT NULL UNIQUE,
    ts            TEXT    NOT NULL,
    actor         TEXT    NOT NULL,
    event_type    TEXT    NOT NULL,
    intent_id     TEXT,
    mandate_id    TEXT,
    amount_paise  INTEGER,
    decision      TEXT,
    summary       TEXT    NOT NULL,
    reasons_json  TEXT    NOT NULL DEFAULT '[]',
    payload_json  TEXT    NOT NULL DEFAULT '{}',
    prev_hash     TEXT    NOT NULL,
    hash          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_intent ON audit_log(intent_id);

-- The audit trail is append-only in the engine itself, not just by convention.
CREATE TRIGGER IF NOT EXISTS audit_log_block_update
BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only: UPDATE is not permitted');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_block_delete
BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only: DELETE is not permitted');
END;
"""


def _database_file() -> Path:
    path = Path(get_settings().database_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _configure(conn: sqlite3.Connection) -> None:
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """Read-oriented connection. Auto-commits on clean exit, rolls back on error."""
    conn = sqlite3.connect(_database_file(), timeout=10.0)
    try:
        _configure(conn)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """Write transaction that takes the reserved lock up front.

    `BEGIN IMMEDIATE` is what stops two concurrent purchase intents from each
    reading the same remaining budget and both deciding they fit inside it.
    """
    conn = sqlite3.connect(_database_file(), timeout=10.0, isolation_level=None)
    try:
        _configure(conn)
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.execute("COMMIT")
    except Exception:
        # Rolling back an already-closed transaction is not itself an error worth
        # masking the original exception with.
        with contextlib.suppress(sqlite3.Error):
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


# Columns added after the first release. `CREATE TABLE IF NOT EXISTS` will not add
# them to a database that already exists, so they are applied by name on boot.
MIGRATIONS: list[tuple[str, str, str]] = [
    ("purchase_intent", "offer_id", "TEXT"),
    ("purchase_intent", "list_amount_paise", "INTEGER NOT NULL DEFAULT 0"),
    ("purchase_intent", "discount_paise", "INTEGER NOT NULL DEFAULT 0"),
    ("offer", "baseline_paise", "INTEGER NOT NULL DEFAULT 0"),
]


def _apply_migrations(conn: sqlite3.Connection) -> None:
    for table, column, ddl in MIGRATIONS:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def init_db() -> None:
    """Create the schema if it does not exist. Safe to call on every boot."""
    with connect() as conn:
        conn.executescript(SCHEMA)
        _apply_migrations(conn)


def reset_db() -> None:
    """Drop every table and rebuild. Used by the test suite and by `POST /demo/reset`."""
    with connect() as conn:
        conn.executescript(
            """
            DROP TRIGGER IF EXISTS audit_log_block_update;
            DROP TRIGGER IF EXISTS audit_log_block_delete;
            DROP TABLE IF EXISTS audit_log;
            DROP TABLE IF EXISTS webhook_event;
            DROP TABLE IF EXISTS offer;
            DROP TABLE IF EXISTS campaign;
            DROP TABLE IF EXISTS product_economics;
            DROP TABLE IF EXISTS payment;
            DROP TABLE IF EXISTS purchase_intent;
            DROP TABLE IF EXISTS mandate;
            DROP TABLE IF EXISTS product;
            """
        )
        conn.executescript(SCHEMA)


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None
