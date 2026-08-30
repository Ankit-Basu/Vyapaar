"""Merchant-private unit economics.

Cost price is the one number in this system that must never reach a buying agent.
It lives in its own table, is absent from the `Product` model entirely, and is
read only by the growth engine when it decides whether an offer clears the margin
floor. An agent learns what it saves; it never learns what the merchant keeps.

Costs are *derived*, not hand-authored, so the demo is reproducible on any machine
with no extra seed file to keep in sync with the catalog. The derivation is a pure
function of the product id and category, which means it is stable across resets and
identical for every judge who runs this.
"""

from __future__ import annotations

import hashlib

from ..db import connect, transaction
from ..models import iso, utcnow

# Baseline gross margin by category, in basis points. These are roughly what the
# categories actually earn in Indian retail: consumer electronics is famously
# thin, homeware and fitness carry far more room.
CATEGORY_MARGIN_BPS: dict[str, int] = {
    "electronics": 1800,
    "office": 3200,
    "home_kitchen": 3800,
    "fitness": 4200,
}
DEFAULT_MARGIN_BPS = 2500

# Real catalogs are not uniform inside a category. A deterministic spread of
# +/- this many basis points, keyed off the product id, gives the growth engine
# something honest to discriminate on -- some products can carry a bundle
# discount and some genuinely cannot.
MARGIN_JITTER_BPS = 400


def baseline_margin_bps(product_id: str, category: str) -> int:
    """Gross margin for one product, in basis points. Deterministic and stable."""
    base = CATEGORY_MARGIN_BPS.get(category, DEFAULT_MARGIN_BPS)
    digest = hashlib.sha256(product_id.encode("utf-8")).digest()
    # digest[0] in 0..255 maps onto [-JITTER, +JITTER].
    spread = (digest[0] / 255.0) * (2 * MARGIN_JITTER_BPS) - MARGIN_JITTER_BPS
    return max(200, int(round(base + spread)))


def derive_cost_paise(product_id: str, category: str, price_paise: int) -> int:
    """Cost = price x (1 - margin). Integer paise, never a float."""
    margin_bps = baseline_margin_bps(product_id, category)
    return int(round(price_paise * (10000 - margin_bps) / 10000))


def seed_economics() -> dict[str, int]:
    """Derive and store a cost for every catalogued product that lacks one.

    Idempotent: called on every boot, only fills gaps. Re-seeding the catalog with
    new products picks them up on the next call.
    """
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT p.id, p.category, p.price_paise
            FROM product p
            LEFT JOIN product_economics e ON e.product_id = p.id
            WHERE e.product_id IS NULL
            """
        ).fetchall()

    if not rows:
        return {"inserted": 0}

    now = iso(utcnow())
    with transaction() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO product_economics (product_id, cost_paise, updated_at) "
            "VALUES (?, ?, ?)",
            [
                (r["id"], derive_cost_paise(r["id"], r["category"], r["price_paise"]), now)
                for r in rows
            ],
        )
    return {"inserted": len(rows)}


def get_cost_paise(product_id: str) -> int | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT cost_paise FROM product_economics WHERE product_id = ?", (product_id,)
        ).fetchone()
    return None if row is None else int(row["cost_paise"])


def get_costs(product_ids: list[str]) -> dict[str, int]:
    """Batch lookup. The engine prices a whole bundle in one pass."""
    if not product_ids:
        return {}
    placeholders = ",".join("?" for _ in product_ids)
    with connect() as conn:
        rows = conn.execute(
            f"SELECT product_id, cost_paise FROM product_economics WHERE product_id IN ({placeholders})",
            product_ids,
        ).fetchall()
    return {r["product_id"]: int(r["cost_paise"]) for r in rows}


def set_cost_paise(product_id: str, cost_paise: int) -> None:
    """Override a derived cost. Used by tests to drive a product to a thin margin."""
    with transaction() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO product_economics (product_id, cost_paise, updated_at) "
            "VALUES (?, ?, ?)",
            (product_id, cost_paise, iso(utcnow())),
        )


def margin_report() -> list[dict[str, object]]:
    """Merchant-only view: what every product costs and earns at list price.

    Served at `GET /growth/economics`, which is deliberately a different route from
    anything under `/catalog` so the separation is visible in the URL.
    """
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT p.id, p.title, p.category, p.price_paise, p.stock, e.cost_paise
            FROM product p
            JOIN product_economics e ON e.product_id = p.id
            ORDER BY p.category, p.title
            """
        ).fetchall()

    report: list[dict[str, object]] = []
    for r in rows:
        price = int(r["price_paise"])
        cost = int(r["cost_paise"])
        margin = price - cost
        report.append(
            {
                "product_id": r["id"],
                "title": r["title"],
                "category": r["category"],
                "price_paise": price,
                "cost_paise": cost,
                "margin_paise": margin,
                "margin_bps": int(round(margin * 10000 / price)) if price else 0,
                "stock": int(r["stock"]),
            }
        )
    return report
