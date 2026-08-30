"""Campaign store and the discount ledger.

A campaign is the merchant's mandate: a signed-off envelope of discount the growth
agent may give away, with a margin floor underneath it and a human gate above it.
The accounting is the same three-phase ledger the buy side uses, because a discount
in flight is exactly as real as budget in flight -- two agents each being offered
the last rupee of a campaign cannot both have it.

  reserve  -- an offer is published or gated; the discount is held
  settle   -- the offer's intent settles; the hold becomes given-away spend
  release  -- the offer expires, is declined, or its payment fails; the hold returns

The availability test lives in the SQL WHERE clause, not in Python, for the same
reason it does on the buy side.
"""

from __future__ import annotations

import json
import secrets
import sqlite3

from ..config import get_settings
from ..db import connect, transaction
from ..models import Campaign, CampaignCreateRequest, iso, utcnow

DEFAULT_CAMPAIGN_NAME = "Festive Attach"

# Defaults sized against this catalog. Electronics carries roughly 18% gross margin,
# so a 9% bundle discount lands just under 8.3% post-discount and a 12% volume tier
# lands near 5%: an 8% floor therefore passes the bundle and genuinely refuses the
# volume tier, rather than passing everything or refusing everything. The gate sits
# at INR 800 of discount, which the cheap lines never reach and a bundle on the
# chair or the headphones always does.
DEFAULT_DISCOUNT_BUDGET_PAISE = 5_000_00
DEFAULT_MAX_DISCOUNT_BPS = 1500
DEFAULT_FLOOR_MARGIN_BPS = 800
DEFAULT_DEEP_DISCOUNT_GATE_PAISE = 800_00


def _campaign_id() -> str:
    return f"cmp_{secrets.token_hex(8)}"


def _row_to_campaign(row: sqlite3.Row) -> Campaign:
    return Campaign(
        campaign_id=row["campaign_id"],
        name=row["name"],
        merchant_id=row["merchant_id"],
        status=row["status"],
        discount_budget_paise=row["discount_budget_paise"],
        discount_spent_paise=row["discount_spent_paise"],
        discount_reserved_paise=row["discount_reserved_paise"],
        max_discount_bps=row["max_discount_bps"],
        floor_margin_bps=row["floor_margin_bps"],
        deep_discount_gate_paise=row["deep_discount_gate_paise"],
        allowed_categories=json.loads(row["allowed_categories_json"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def create(request: CampaignCreateRequest) -> Campaign:
    settings = get_settings()
    now = iso(utcnow())
    campaign = Campaign(
        campaign_id=_campaign_id(),
        name=request.name,
        merchant_id=settings.merchant_id,
        status="ACTIVE",
        discount_budget_paise=request.discount_budget_paise,
        discount_spent_paise=0,
        discount_reserved_paise=0,
        max_discount_bps=request.max_discount_bps,
        floor_margin_bps=request.floor_margin_bps,
        deep_discount_gate_paise=request.deep_discount_gate_paise,
        allowed_categories=[c.strip().lower() for c in request.allowed_categories if c.strip()],
        created_at=now,
        updated_at=now,
    )
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO campaign (campaign_id, name, merchant_id, status,
                                  discount_budget_paise, discount_spent_paise,
                                  discount_reserved_paise, max_discount_bps,
                                  floor_margin_bps, deep_discount_gate_paise,
                                  allowed_categories_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                campaign.campaign_id,
                campaign.name,
                campaign.merchant_id,
                campaign.status,
                campaign.discount_budget_paise,
                0,
                0,
                campaign.max_discount_bps,
                campaign.floor_margin_bps,
                campaign.deep_discount_gate_paise,
                json.dumps(campaign.allowed_categories),
                now,
                now,
            ),
        )
    return campaign


def get(campaign_id: str) -> Campaign | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM campaign WHERE campaign_id = ?", (campaign_id,)
        ).fetchone()
    return None if row is None else _row_to_campaign(row)


def list_campaigns() -> list[Campaign]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM campaign ORDER BY created_at DESC").fetchall()
    return [_row_to_campaign(r) for r in rows]


def active_campaign() -> Campaign | None:
    """The campaign offers are made under. The demo runs one at a time."""
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM campaign WHERE status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
    return None if row is None else _row_to_campaign(row)


def set_status(campaign_id: str, status: str) -> Campaign | None:
    with transaction() as conn:
        conn.execute(
            "UPDATE campaign SET status = ?, updated_at = ? WHERE campaign_id = ?",
            (status, iso(utcnow()), campaign_id),
        )
    return get(campaign_id)


def ensure_default_campaign() -> Campaign:
    """Boot-time: a merchant with no campaign makes no offers at all.

    Idempotent, so restarting the API does not stack up campaigns.
    """
    existing = active_campaign()
    if existing is not None:
        return existing
    return create(
        CampaignCreateRequest(
            name=DEFAULT_CAMPAIGN_NAME,
            discount_budget_paise=DEFAULT_DISCOUNT_BUDGET_PAISE,
            max_discount_bps=DEFAULT_MAX_DISCOUNT_BPS,
            floor_margin_bps=DEFAULT_FLOOR_MARGIN_BPS,
            deep_discount_gate_paise=DEFAULT_DEEP_DISCOUNT_GATE_PAISE,
            allowed_categories=[],
        )
    )


# --------------------------------------------------------------------------
# Discount ledger -- reserve / settle / release
# --------------------------------------------------------------------------


def reserve(campaign_id: str, discount_paise: int, conn: sqlite3.Connection) -> bool:
    """Hold discount budget against a live offer.

    The availability test is in the WHERE clause so two offers racing for the last
    rupee of a campaign cannot both be published.
    """
    if discount_paise <= 0:
        return True
    cursor = conn.execute(
        """
        UPDATE campaign
           SET discount_reserved_paise = discount_reserved_paise + ?
         WHERE campaign_id = ?
           AND status = 'ACTIVE'
           AND (discount_budget_paise - discount_spent_paise - discount_reserved_paise) >= ?
        """,
        (discount_paise, campaign_id, discount_paise),
    )
    return cursor.rowcount > 0


def settle(campaign_id: str, discount_paise: int, conn: sqlite3.Connection) -> bool:
    """Convert a hold into discount actually given away. Called on settled payment."""
    if discount_paise <= 0:
        return True
    cursor = conn.execute(
        """
        UPDATE campaign
           SET discount_reserved_paise = discount_reserved_paise - ?,
               discount_spent_paise    = discount_spent_paise + ?
         WHERE campaign_id = ? AND discount_reserved_paise >= ?
        """,
        (discount_paise, discount_paise, campaign_id, discount_paise),
    )
    return cursor.rowcount > 0


def release(campaign_id: str, discount_paise: int, conn: sqlite3.Connection) -> bool:
    """Drop a hold without giving anything away: declined, expired, or payment failed."""
    if discount_paise <= 0:
        return True
    cursor = conn.execute(
        """
        UPDATE campaign
           SET discount_reserved_paise = discount_reserved_paise - ?
         WHERE campaign_id = ? AND discount_reserved_paise >= ?
        """,
        (discount_paise, campaign_id, discount_paise),
    )
    return cursor.rowcount > 0
