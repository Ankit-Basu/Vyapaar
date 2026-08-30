"""Revenue attribution: what the growth agent was actually worth.

Every number here is measured against a counterfactual, not asserted. When an
offer is built, the builder records `baseline_paise` -- what that buyer would have
paid had no offer been made, which is one anchor at list price. Uplift is settled
revenue minus the sum of those baselines, over settled orders only.

Two consequences worth stating plainly:

* An offer that is published but never accepted contributes nothing. Impressions
  are not revenue.
* An offer that is accepted but whose payment fails contributes nothing either.
  Only a Razorpay-verified settlement counts, which is the same rule the buy-side
  budget ledger uses.

`margin_protected_paise` is the mirror image: discount the gauntlet refused to
give away. It is the clearest single number for what the guardrails are worth to
the merchant, and it only exists because suppressed offers are recorded rather
than dropped.
"""

from __future__ import annotations

import json

from ..db import connect
from ..models import IntentStatus, OfferStatus, RevenueMetrics
from . import economics


def _bps(part: int, whole: int) -> int:
    return int(round(part * 10000 / whole)) if whole else 0


def revenue_metrics() -> RevenueMetrics:
    with connect() as conn:
        settled = conn.execute(
            """
            SELECT i.intent_id, i.amount_paise, i.product_id, i.qty, i.offer_id,
                   i.discount_paise, o.baseline_paise, o.lines_json
            FROM purchase_intent i
            LEFT JOIN offer o ON o.offer_id = i.offer_id
            WHERE i.status = ?
            """,
            (IntentStatus.PAID.value,),
        ).fetchall()

        status_counts = dict(
            conn.execute("SELECT status, COUNT(*) FROM offer GROUP BY status").fetchall()
        )
        protected = conn.execute(
            "SELECT COALESCE(SUM(discount_paise), 0) FROM offer WHERE status = ?",
            (OfferStatus.SUPPRESSED.value,),
        ).fetchone()[0]

    settled_gmv = 0
    baseline_gmv = 0
    discount_given = 0
    cost_total = 0
    with_offer: list[int] = []
    without_offer: list[int] = []

    # Cost is needed per settled line to report margin actually earned.
    all_costs = economics.get_costs(
        [r["product_id"] for r in settled] + _offer_line_ids(settled)
    )

    for row in settled:
        amount = int(row["amount_paise"])
        settled_gmv += amount

        if row["offer_id"]:
            baseline_gmv += int(row["baseline_paise"] or 0)
            discount_given += int(row["discount_paise"] or 0)
            with_offer.append(amount)
            cost_total += _offer_cost(row["lines_json"], all_costs)
        else:
            # With no offer the counterfactual is the order itself.
            baseline_gmv += amount
            without_offer.append(amount)
            cost_total += all_costs.get(row["product_id"], 0) * int(row["qty"])

    orders = len(settled)
    uplift = settled_gmv - baseline_gmv

    return RevenueMetrics(
        settled_gmv_paise=settled_gmv,
        baseline_gmv_paise=baseline_gmv,
        uplift_paise=uplift,
        uplift_bps=_bps(uplift, baseline_gmv),
        orders=orders,
        aov_paise=settled_gmv // orders if orders else 0,
        aov_without_offer_paise=(
            sum(without_offer) // len(without_offer) if without_offer else 0
        ),
        aov_with_offer_paise=sum(with_offer) // len(with_offer) if with_offer else 0,
        attach_rate_bps=_bps(len(with_offer), orders),
        discount_given_paise=discount_given,
        margin_earned_paise=settled_gmv - cost_total,
        offers_published=int(status_counts.get(OfferStatus.PUBLISHED.value, 0)),
        offers_accepted=int(status_counts.get(OfferStatus.ACCEPTED.value, 0)),
        offers_declined=int(status_counts.get(OfferStatus.DECLINED.value, 0)),
        offers_suppressed=int(status_counts.get(OfferStatus.SUPPRESSED.value, 0)),
        offers_gated=int(status_counts.get(OfferStatus.GATED.value, 0)),
        margin_protected_paise=int(protected or 0),
    )


def _offer_line_ids(rows: list) -> list[str]:
    ids: list[str] = []
    for row in rows:
        if row["lines_json"]:
            ids.extend(line["product_id"] for line in json.loads(row["lines_json"]))
    return ids


def _offer_cost(lines_json: str | None, costs: dict[str, int]) -> int:
    if not lines_json:
        return 0
    return sum(
        costs.get(line["product_id"], 0) * int(line["qty"]) for line in json.loads(lines_json)
    )
