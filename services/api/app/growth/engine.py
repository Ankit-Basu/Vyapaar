"""The margin gauntlet -- the sell-side mirror of `policy/engine.py`.

Every offer the merchant's growth agent wants to make passes through `evaluate()`
before an agent can see it. There is no other path from the offer builder to the
published feed.

Like the buy-side engine this is a *pure function*: it takes an assembled context
and returns a decision. It never reads the database and never calls Razorpay, so
each check is unit-testable in isolation and every published or suppressed offer
is reproducible from its audit payload alone.

The ordering is the same idea pointed the other way. Authorisation first (is there
a live campaign, is this category in scope), then truthfulness, then the merchant's
own bounds (margin, discount ceiling, fulfilment, campaign budget), then the
*buyer's* bounds, and the human gate last so it only fires on an otherwise-clean
offer.

Check 8 is the one worth reading twice. When the caller presented a mandate, the
merchant refuses to make an offer the buyer is not allowed to accept. A merchant
that pushes an agent past its principal's limits is not being persuasive, it is
wasting both sides' time and manufacturing a denial. Bounded selling.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ..models import (
    Campaign,
    CheckStatus,
    MandateRecord,
    OfferAction,
    OfferCheck,
    OfferDecision,
    OfferKind,
    OfferLine,
    iso,
    utcnow,
)

GROWTH_POLICY_VERSION = "vyapaar.growth.v1"


def _inr(paise: int) -> str:
    return f"INR {paise / 100:,.2f}"


def _pct(bps: int) -> str:
    return f"{bps / 100:.2f}%"


@dataclass(frozen=True)
class OfferContext:
    """Everything the margin gauntlet is allowed to know."""

    kind: OfferKind
    anchor_product_id: str
    anchor_category: str
    lines: list[OfferLine]
    list_total_paise: int
    offer_total_paise: int
    discount_paise: int
    discount_bps: int
    cost_total_paise: int
    campaign: Campaign | None = None
    campaign_invalid_reason: str | None = None
    # Live catalog prices keyed by product id, used to prove the offer's arithmetic
    # against the merchant's own source of truth rather than against itself.
    catalog_prices: dict[str, int] = field(default_factory=dict)
    stock_levels: dict[str, int] = field(default_factory=dict)
    # The buyer's mandate, when the caller presented one. None means an anonymous
    # agent, in which case the buy-side gauntlet catches an over-cap offer later.
    mandate: MandateRecord | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def margin_paise(self) -> int:
        return self.offer_total_paise - self.cost_total_paise

    @property
    def margin_bps(self) -> int:
        if self.offer_total_paise <= 0:
            return 0
        return int(round(self.margin_paise * 10000 / self.offer_total_paise))


CheckFn = Callable[[OfferContext], OfferCheck]


# --------------------------------------------------------------------------
# Individual checks
# --------------------------------------------------------------------------


def check_campaign_active(ctx: OfferContext) -> OfferCheck:
    if ctx.campaign is None:
        return OfferCheck(
            id="campaign_active",
            name="A live campaign authorises this offer",
            status=CheckStatus.FAIL,
            reason=(
                ctx.campaign_invalid_reason
                or "No active campaign authorises discounting. The merchant has not signed off "
                "on giving anything away, so nothing is offered."
            ),
            observed={"campaign_present": False},
        )
    if ctx.campaign.status != "ACTIVE":
        return OfferCheck(
            id="campaign_active",
            name="A live campaign authorises this offer",
            status=CheckStatus.FAIL,
            reason=(
                f"Campaign '{ctx.campaign.name}' is {ctx.campaign.status}, not ACTIVE. "
                "A paused campaign makes no offers."
            ),
            observed={"campaign_id": ctx.campaign.campaign_id, "status": ctx.campaign.status},
        )
    return OfferCheck(
        id="campaign_active",
        name="A live campaign authorises this offer",
        status=CheckStatus.PASS,
        reason=(
            f"Campaign '{ctx.campaign.name}' is active with "
            f"{_inr(ctx.campaign.discount_available_paise)} of discount budget left."
        ),
        observed={
            "campaign_id": ctx.campaign.campaign_id,
            "discount_available_paise": ctx.campaign.discount_available_paise,
        },
    )


def check_category_in_campaign(ctx: OfferContext) -> OfferCheck:
    assert ctx.campaign is not None
    allowed = ctx.campaign.allowed_categories
    # An empty allow-list means the campaign covers the whole catalog.
    if allowed and ctx.anchor_category not in allowed:
        return OfferCheck(
            id="category_in_campaign",
            name="Category is inside the campaign's scope",
            status=CheckStatus.FAIL,
            reason=(
                f"Category '{ctx.anchor_category}' is outside this campaign's scope {allowed}. "
                "The merchant chose not to discount here."
            ),
            observed={"anchor_category": ctx.anchor_category, "campaign_categories": allowed},
        )
    return OfferCheck(
        id="category_in_campaign",
        name="Category is inside the campaign's scope",
        status=CheckStatus.PASS,
        reason=(
            f"Category '{ctx.anchor_category}' is in scope for this campaign"
            + (f" {allowed}." if allowed else " (whole catalog).")
        ),
        observed={"anchor_category": ctx.anchor_category, "campaign_categories": allowed},
    )


def check_offer_integrity(ctx: OfferContext) -> OfferCheck:
    """The offer's own arithmetic must reconcile against the live catalog.

    This is the anti-dark-pattern check. An offer that inflates its "was" price to
    manufacture a saving, or whose lines do not add up to the total it claims, is
    suppressed. A machine buyer cannot smell a fake discount the way a person can,
    which makes it the merchant's job to prove the number.
    """
    problems: list[str] = []

    for line in ctx.lines:
        catalog_price = ctx.catalog_prices.get(line.product_id)
        if catalog_price is None:
            problems.append(f"{line.product_id} is not in the catalog")
            continue
        if line.unit_price_paise != catalog_price:
            problems.append(
                f"{line.product_id} is quoted at {_inr(line.unit_price_paise)} but the catalog "
                f"says {_inr(catalog_price)}"
            )
        if line.line_total_paise != line.unit_price_paise * line.qty:
            problems.append(
                f"{line.product_id} line total {_inr(line.line_total_paise)} does not equal "
                f"{_inr(line.unit_price_paise)} x {line.qty}"
            )

    lines_sum = sum(line.line_total_paise for line in ctx.lines)
    if lines_sum != ctx.list_total_paise:
        problems.append(
            f"lines add up to {_inr(lines_sum)} but the offer claims a list total of "
            f"{_inr(ctx.list_total_paise)}"
        )
    if ctx.list_total_paise - ctx.discount_paise != ctx.offer_total_paise:
        problems.append(
            f"{_inr(ctx.list_total_paise)} minus {_inr(ctx.discount_paise)} is not "
            f"{_inr(ctx.offer_total_paise)}"
        )
    if ctx.discount_paise < 0 or ctx.offer_total_paise < 0:
        problems.append("an offer may not carry a negative discount or total")

    expected_bps = (
        int(round(ctx.discount_paise * 10000 / ctx.list_total_paise)) if ctx.list_total_paise else 0
    )
    if abs(expected_bps - ctx.discount_bps) > 1:  # 1bp of integer rounding slack
        problems.append(
            f"stated saving of {_pct(ctx.discount_bps)} does not match the actual "
            f"{_pct(expected_bps)}"
        )

    if problems:
        return OfferCheck(
            id="offer_integrity",
            name="The offer's arithmetic is truthful",
            status=CheckStatus.FAIL,
            reason=(
                "The offer does not reconcile against the live catalog: "
                + "; ".join(problems)
                + ". An agent cannot see through a fake saving, so a saving that cannot be "
                "proven is not offered."
            ),
            observed={"problems": problems, "lines_sum_paise": lines_sum},
        )
    return OfferCheck(
        id="offer_integrity",
        name="The offer's arithmetic is truthful",
        status=CheckStatus.PASS,
        reason=(
            f"Every line matches the live catalog and the totals reconcile: "
            f"{_inr(ctx.list_total_paise)} list, {_inr(ctx.discount_paise)} off, "
            f"{_inr(ctx.offer_total_paise)} payable ({_pct(ctx.discount_bps)})."
        ),
        observed={
            "list_total_paise": ctx.list_total_paise,
            "discount_paise": ctx.discount_paise,
            "offer_total_paise": ctx.offer_total_paise,
            "discount_bps": ctx.discount_bps,
        },
    )


def check_margin_floor(ctx: OfferContext) -> OfferCheck:
    assert ctx.campaign is not None
    floor = ctx.campaign.floor_margin_bps
    observed = {
        "margin_paise": ctx.margin_paise,
        "margin_bps": ctx.margin_bps,
        "floor_margin_bps": floor,
        "offer_total_paise": ctx.offer_total_paise,
    }
    if ctx.margin_bps < floor:
        return OfferCheck(
            id="margin_floor",
            name="Post-discount margin clears the floor",
            status=CheckStatus.FAIL,
            reason=(
                f"After {_inr(ctx.discount_paise)} off, this offer earns {_pct(ctx.margin_bps)} "
                f"margin, below the campaign floor of {_pct(floor)}. Growing revenue by selling "
                "at a loss is not growth."
            ),
            observed=observed,
        )
    return OfferCheck(
        id="margin_floor",
        name="Post-discount margin clears the floor",
        status=CheckStatus.PASS,
        reason=(
            f"Even after {_inr(ctx.discount_paise)} off, the merchant keeps "
            f"{_inr(ctx.margin_paise)} ({_pct(ctx.margin_bps)}), clear of the "
            f"{_pct(floor)} floor."
        ),
        observed=observed,
    )


def check_discount_cap(ctx: OfferContext) -> OfferCheck:
    assert ctx.campaign is not None
    cap = ctx.campaign.max_discount_bps
    if ctx.discount_bps > cap:
        return OfferCheck(
            id="discount_cap",
            name="Discount is within the campaign ceiling",
            status=CheckStatus.FAIL,
            reason=(
                f"{_pct(ctx.discount_bps)} off exceeds the campaign's ceiling of {_pct(cap)} "
                f"by {_pct(ctx.discount_bps - cap)}. No single offer may cross this line."
            ),
            observed={"discount_bps": ctx.discount_bps, "max_discount_bps": cap},
        )
    return OfferCheck(
        id="discount_cap",
        name="Discount is within the campaign ceiling",
        status=CheckStatus.PASS,
        reason=f"{_pct(ctx.discount_bps)} off is within the campaign ceiling of {_pct(cap)}.",
        observed={"discount_bps": ctx.discount_bps, "max_discount_bps": cap},
    )


def check_stock_cover(ctx: OfferContext) -> OfferCheck:
    short: list[dict[str, Any]] = []
    for line in ctx.lines:
        have = ctx.stock_levels.get(line.product_id, 0)
        if have < line.qty:
            short.append({"product_id": line.product_id, "stock": have, "needed": line.qty})
    if short:
        names = ", ".join(f"{s['product_id']} ({s['stock']} of {s['needed']})" for s in short)
        return OfferCheck(
            id="stock_cover",
            name="Every item in the offer can be shipped",
            status=CheckStatus.FAIL,
            reason=(
                f"Not enough stock to honour this offer: {names}. Promoting something the "
                "merchant cannot ship converts a sale into a refund."
            ),
            observed={"short": short},
        )
    return OfferCheck(
        id="stock_cover",
        name="Every item in the offer can be shipped",
        status=CheckStatus.PASS,
        reason=(
            f"All {len(ctx.lines)} line(s) are in stock for the quantities offered."
        ),
        observed={
            "lines": [
                {
                    "product_id": line.product_id,
                    "qty": line.qty,
                    "stock": ctx.stock_levels.get(line.product_id, 0),
                }
                for line in ctx.lines
            ]
        },
    )


def check_campaign_budget(ctx: OfferContext) -> OfferCheck:
    assert ctx.campaign is not None
    campaign = ctx.campaign
    available = campaign.discount_available_paise
    observed = {
        "discount_paise": ctx.discount_paise,
        "discount_budget_paise": campaign.discount_budget_paise,
        "discount_spent_paise": campaign.discount_spent_paise,
        "discount_reserved_paise": campaign.discount_reserved_paise,
        "discount_available_paise": available,
    }
    if ctx.discount_paise > available:
        return OfferCheck(
            id="campaign_budget",
            name="Campaign has discount budget left",
            status=CheckStatus.FAIL,
            reason=(
                f"Giving away {_inr(ctx.discount_paise)} would exceed the "
                f"{_inr(available)} of discount budget still available (budget "
                f"{_inr(campaign.discount_budget_paise)} minus "
                f"{_inr(campaign.discount_spent_paise)} already given and "
                f"{_inr(campaign.discount_reserved_paise)} held against live offers). "
                f"Short by {_inr(ctx.discount_paise - available)}."
            ),
            observed=observed,
        )
    return OfferCheck(
        id="campaign_budget",
        name="Campaign has discount budget left",
        status=CheckStatus.PASS,
        reason=(
            f"{_inr(ctx.discount_paise)} fits inside the {_inr(available)} of discount budget "
            f"left; {_inr(available - ctx.discount_paise)} would remain."
        ),
        observed=observed,
    )


def check_buyer_bounds(ctx: OfferContext) -> OfferCheck:
    """Refuse to offer what the buyer's mandate would not let it accept.

    Only meaningful when the caller presented a mandate. An anonymous agent gets
    the offer and its own guardrails will judge it at intent time; a mandate-aware
    caller gets merchandising fitted to what it may actually spend.
    """
    if ctx.mandate is None:
        return OfferCheck(
            id="buyer_bounds",
            name="Offer fits inside the buyer's mandate",
            status=CheckStatus.PASS,
            reason=(
                "No mandate was presented, so the offer is published unfitted. The buy-side "
                "gauntlet will still judge it against whatever mandate is used to accept it."
            ),
            observed={"mandate_present": False},
        )

    mandate = ctx.mandate
    offer_categories = sorted({line.category for line in ctx.lines})
    out_of_scope = [c for c in offer_categories if c not in mandate.allowed_categories]
    observed = {
        "mandate_id": mandate.mandate_id,
        "offer_total_paise": ctx.offer_total_paise,
        "per_txn_cap_paise": mandate.per_txn_cap_paise,
        "available_paise": mandate.available_paise,
        "offer_categories": offer_categories,
        "allowed_categories": mandate.allowed_categories,
    }

    if out_of_scope:
        return OfferCheck(
            id="buyer_bounds",
            name="Offer fits inside the buyer's mandate",
            status=CheckStatus.FAIL,
            reason=(
                f"This offer includes {out_of_scope}, which the buyer's mandate does not "
                f"authorise (it permits {mandate.allowed_categories}). Bundling in a category "
                "the agent may not buy would only manufacture a denial."
            ),
            observed=observed,
        )
    if ctx.offer_total_paise > mandate.per_txn_cap_paise:
        return OfferCheck(
            id="buyer_bounds",
            name="Offer fits inside the buyer's mandate",
            status=CheckStatus.FAIL,
            reason=(
                f"At {_inr(ctx.offer_total_paise)} this offer is above the buyer's "
                f"per-transaction cap of {_inr(mandate.per_txn_cap_paise)}. The merchant will "
                "not push an agent at a purchase its principal has forbidden."
            ),
            observed=observed,
        )
    if ctx.offer_total_paise > mandate.available_paise:
        return OfferCheck(
            id="buyer_bounds",
            name="Offer fits inside the buyer's mandate",
            status=CheckStatus.FAIL,
            reason=(
                f"At {_inr(ctx.offer_total_paise)} this offer exceeds the "
                f"{_inr(mandate.available_paise)} the buyer has left to spend. Offering it "
                "would waste a round trip on a purchase that cannot clear."
            ),
            observed=observed,
        )
    return OfferCheck(
        id="buyer_bounds",
        name="Offer fits inside the buyer's mandate",
        status=CheckStatus.PASS,
        reason=(
            f"{_inr(ctx.offer_total_paise)} sits inside the buyer's per-transaction cap of "
            f"{_inr(mandate.per_txn_cap_paise)} and its {_inr(mandate.available_paise)} of "
            "remaining budget, and every category in the bundle is authorised."
        ),
        observed=observed,
    )


def check_deep_discount_gate(ctx: OfferContext) -> OfferCheck:
    assert ctx.campaign is not None
    threshold = ctx.campaign.deep_discount_gate_paise
    if ctx.discount_paise >= threshold:
        return OfferCheck(
            id="deep_discount_gate",
            name="Deep discounts need a human",
            status=CheckStatus.GATE,
            reason=(
                f"Giving away {_inr(ctx.discount_paise)} is at or above the "
                f"{_inr(threshold)} review threshold. Every other guardrail passed, so this is "
                "held for a person to approve rather than suppressed."
            ),
            observed={
                "discount_paise": ctx.discount_paise,
                "deep_discount_gate_paise": threshold,
            },
        )
    return OfferCheck(
        id="deep_discount_gate",
        name="Deep discounts need a human",
        status=CheckStatus.PASS,
        reason=(
            f"{_inr(ctx.discount_paise)} is below the {_inr(threshold)} review threshold; "
            "the growth agent may publish this on its own authority."
        ),
        observed={"discount_paise": ctx.discount_paise, "deep_discount_gate_paise": threshold},
    )


# Authorisation, then truthfulness, then the merchant's bounds, then the buyer's,
# then the human gate -- which fires only on an otherwise-clean offer.
ORDERED_CHECKS: list[tuple[str, str, CheckFn]] = [
    ("campaign_active", "A live campaign authorises this offer", check_campaign_active),
    ("category_in_campaign", "Category is inside the campaign's scope", check_category_in_campaign),
    ("offer_integrity", "The offer's arithmetic is truthful", check_offer_integrity),
    ("margin_floor", "Post-discount margin clears the floor", check_margin_floor),
    ("discount_cap", "Discount is within the campaign ceiling", check_discount_cap),
    ("stock_cover", "Every item in the offer can be shipped", check_stock_cover),
    ("campaign_budget", "Campaign has discount budget left", check_campaign_budget),
    ("buyer_bounds", "Offer fits inside the buyer's mandate", check_buyer_bounds),
    ("deep_discount_gate", "Deep discounts need a human", check_deep_discount_gate),
]


def evaluate(ctx: OfferContext) -> OfferDecision:
    """Run every sell-side guardrail in order and return an explainable decision."""
    checks: list[OfferCheck] = []
    failed_at: OfferCheck | None = None
    gated_at: OfferCheck | None = None

    for check_id, check_name, check_fn in ORDERED_CHECKS:
        if failed_at is not None:
            checks.append(
                OfferCheck(
                    id=check_id,
                    name=check_name,
                    status=CheckStatus.SKIPPED,
                    reason=(
                        f"Not evaluated: '{failed_at.id}' already suppressed this offer, and no "
                        "later check could reverse that."
                    ),
                    observed={},
                )
            )
            continue

        result = check_fn(ctx)
        checks.append(result)
        if result.status == CheckStatus.FAIL:
            failed_at = result
        elif result.status == CheckStatus.GATE:
            gated_at = result

    if failed_at is not None:
        return OfferDecision(
            action=OfferAction.SUPPRESS,
            reasons=[failed_at.reason],
            checks=checks,
            evaluated_at=iso(utcnow()),
            policy_version=GROWTH_POLICY_VERSION,
        )
    if gated_at is not None:
        return OfferDecision(
            action=OfferAction.GATE_FOR_HUMAN,
            reasons=[gated_at.reason],
            checks=checks,
            evaluated_at=iso(utcnow()),
            policy_version=GROWTH_POLICY_VERSION,
        )
    return OfferDecision(
        action=OfferAction.AUTO_PUBLISH,
        reasons=[
            f"All {len(checks)} margin guardrails passed; the discount is funded, the margin "
            "holds and the buyer is allowed to accept it."
        ],
        checks=checks,
        evaluated_at=iso(utcnow()),
        policy_version=GROWTH_POLICY_VERSION,
    )
