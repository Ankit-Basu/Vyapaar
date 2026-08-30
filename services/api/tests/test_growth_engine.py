"""The margin gauntlet, check by check.

Every test here builds an `OfferContext` by hand and calls `evaluate()` directly.
That is only possible because the engine is a pure function -- no database, no
network -- which is the same property the buy-side engine has and the same reason
its tests read this way.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.growth.engine import ORDERED_CHECKS, OfferContext, evaluate
from app.models import (
    Campaign,
    CheckStatus,
    MandateRecord,
    OfferAction,
    OfferKind,
    OfferLine,
    iso,
    utcnow,
)


def make_campaign(**over) -> Campaign:
    base = dict(
        campaign_id="cmp_test",
        name="Test Campaign",
        merchant_id="merch_kirana_labs",
        status="ACTIVE",
        discount_budget_paise=500_000,
        discount_spent_paise=0,
        discount_reserved_paise=0,
        max_discount_bps=1500,
        floor_margin_bps=800,
        deep_discount_gate_paise=80_000,
        allowed_categories=[],
        created_at=iso(utcnow()),
        updated_at=iso(utcnow()),
    )
    base.update(over)
    return Campaign(**base)


def make_mandate(**over) -> MandateRecord:
    base = dict(
        mandate_id="mdt_test",
        buyer_id="buyer_test",
        merchant_id="merch_kirana_labs",
        per_txn_cap_paise=300_000,
        total_budget_paise=1_000_000,
        spent_paise=0,
        reserved_paise=0,
        allowed_categories=["electronics", "office"],
        issued_at=iso(utcnow()),
        expires_at=iso(utcnow() + timedelta(hours=24)),
    )
    base.update(over)
    return MandateRecord(**base)


def make_ctx(**over) -> OfferContext:
    """A clean two-line bundle that clears every guardrail."""
    lines = over.pop(
        "lines",
        [
            OfferLine(
                product_id="prod_a", title="Anchor", category="electronics", qty=1,
                unit_price_paise=100_000, line_total_paise=100_000, is_anchor=True,
            ),
            OfferLine(
                product_id="prod_b", title="Complement", category="electronics", qty=1,
                unit_price_paise=40_000, line_total_paise=40_000,
            ),
        ],
    )
    list_total = over.pop("list_total_paise", sum(line.line_total_paise for line in lines))
    discount = over.pop("discount_paise", 10_000)
    base = dict(
        kind=OfferKind.BUNDLE,
        anchor_product_id="prod_a",
        anchor_category="electronics",
        lines=lines,
        list_total_paise=list_total,
        offer_total_paise=list_total - discount,
        discount_paise=discount,
        discount_bps=round(discount * 10000 / list_total),
        # 130,000 payable against 100,000 cost is a 23% margin: comfortably clear.
        cost_total_paise=100_000,
        campaign=make_campaign(),
        catalog_prices={"prod_a": 100_000, "prod_b": 40_000},
        stock_levels={"prod_a": 50, "prod_b": 50},
        mandate=None,
    )
    base.update(over)
    return OfferContext(**base)


def check(decision, check_id):
    return next(c for c in decision.checks if c.id == check_id)


def test_a_clean_offer_is_published():
    decision = evaluate(make_ctx())
    assert decision.action is OfferAction.AUTO_PUBLISH
    assert all(c.status is CheckStatus.PASS for c in decision.checks)
    assert len(decision.checks) == len(ORDERED_CHECKS)


def test_every_check_reports_a_reason():
    """An unexplained decision is not an explainable one."""
    decision = evaluate(make_ctx())
    for c in decision.checks:
        assert c.reason.strip(), f"{c.id} returned no reason"
        assert len(c.reason) > 20, f"{c.id} reason is too thin to show a judge"


# --------------------------------------------------------------------------
# campaign_active / category_in_campaign
# --------------------------------------------------------------------------


def test_no_campaign_means_no_offers():
    decision = evaluate(make_ctx(campaign=None))
    assert decision.action is OfferAction.SUPPRESS
    assert check(decision, "campaign_active").status is CheckStatus.FAIL


def test_paused_campaign_offers_nothing():
    decision = evaluate(make_ctx(campaign=make_campaign(status="PAUSED")))
    assert decision.action is OfferAction.SUPPRESS
    assert "PAUSED" in check(decision, "campaign_active").reason


def test_category_outside_campaign_scope_is_suppressed():
    decision = evaluate(
        make_ctx(campaign=make_campaign(allowed_categories=["home_kitchen"]))
    )
    assert decision.action is OfferAction.SUPPRESS
    assert check(decision, "category_in_campaign").status is CheckStatus.FAIL


def test_empty_campaign_scope_means_whole_catalog():
    decision = evaluate(make_ctx(campaign=make_campaign(allowed_categories=[])))
    assert check(decision, "category_in_campaign").status is CheckStatus.PASS


# --------------------------------------------------------------------------
# offer_integrity -- the anti-dark-pattern check
# --------------------------------------------------------------------------


def test_an_inflated_was_price_is_refused():
    """Claiming a higher list price than the catalog carries manufactures a saving."""
    lines = [
        OfferLine(
            product_id="prod_a", title="Anchor", category="electronics", qty=1,
            unit_price_paise=200_000, line_total_paise=200_000, is_anchor=True,
        )
    ]
    decision = evaluate(
        make_ctx(lines=lines, list_total_paise=200_000, discount_paise=20_000)
    )
    assert decision.action is OfferAction.SUPPRESS
    integrity = check(decision, "offer_integrity")
    assert integrity.status is CheckStatus.FAIL
    assert "catalog" in integrity.reason


def test_totals_that_do_not_reconcile_are_refused():
    ctx = make_ctx()
    broken = OfferContext(
        **{
            **{f.name: getattr(ctx, f.name) for f in ctx.__dataclass_fields__.values()},
            "offer_total_paise": ctx.offer_total_paise - 5_000,  # money vanishes
        }
    )
    decision = evaluate(broken)
    assert decision.action is OfferAction.SUPPRESS
    assert check(decision, "offer_integrity").status is CheckStatus.FAIL


def test_an_overstated_saving_is_refused():
    """Advertising 40% off when the arithmetic says 7% is a lie an agent cannot see."""
    ctx = make_ctx()
    lying = OfferContext(
        **{
            **{f.name: getattr(ctx, f.name) for f in ctx.__dataclass_fields__.values()},
            "discount_bps": 4000,
        }
    )
    decision = evaluate(lying)
    assert decision.action is OfferAction.SUPPRESS
    assert "does not match" in check(decision, "offer_integrity").reason


def test_a_line_total_that_is_not_price_times_qty_is_refused():
    lines = [
        OfferLine(
            product_id="prod_a", title="Anchor", category="electronics", qty=2,
            unit_price_paise=100_000, line_total_paise=150_000, is_anchor=True,
        )
    ]
    decision = evaluate(
        make_ctx(lines=lines, list_total_paise=150_000, discount_paise=10_000)
    )
    assert check(decision, "offer_integrity").status is CheckStatus.FAIL


# --------------------------------------------------------------------------
# margin_floor / discount_cap
# --------------------------------------------------------------------------


def test_an_offer_below_the_margin_floor_is_suppressed():
    # 130,000 payable against 125,000 cost is under 4%: below the 8% floor.
    decision = evaluate(make_ctx(cost_total_paise=125_000))
    assert decision.action is OfferAction.SUPPRESS
    margin = check(decision, "margin_floor")
    assert margin.status is CheckStatus.FAIL
    assert "below the campaign floor" in margin.reason


def test_selling_below_cost_is_suppressed():
    decision = evaluate(make_ctx(cost_total_paise=200_000))
    assert decision.action is OfferAction.SUPPRESS
    assert check(decision, "margin_floor").observed["margin_paise"] < 0


def test_a_discount_over_the_ceiling_is_suppressed():
    decision = evaluate(make_ctx(campaign=make_campaign(max_discount_bps=500)))
    assert decision.action is OfferAction.SUPPRESS
    assert check(decision, "discount_cap").status is CheckStatus.FAIL


# --------------------------------------------------------------------------
# stock_cover / campaign_budget
# --------------------------------------------------------------------------


def test_an_offer_the_merchant_cannot_ship_is_suppressed():
    decision = evaluate(make_ctx(stock_levels={"prod_a": 50, "prod_b": 0}))
    assert decision.action is OfferAction.SUPPRESS
    assert check(decision, "stock_cover").status is CheckStatus.FAIL


def test_discount_beyond_the_campaign_budget_is_suppressed():
    decision = evaluate(
        make_ctx(campaign=make_campaign(discount_budget_paise=5_000))
    )
    assert decision.action is OfferAction.SUPPRESS
    budget = check(decision, "campaign_budget")
    assert budget.status is CheckStatus.FAIL
    assert "Short by" in budget.reason


def test_budget_arithmetic_accounts_for_held_discount():
    campaign = make_campaign(
        discount_budget_paise=100_000,
        discount_spent_paise=50_000,
        discount_reserved_paise=45_000,
    )
    decision = evaluate(make_ctx(campaign=campaign))
    # 5,000 available against a 10,000 discount.
    assert check(decision, "campaign_budget").status is CheckStatus.FAIL
    assert check(decision, "campaign_budget").observed["discount_available_paise"] == 5_000


# --------------------------------------------------------------------------
# buyer_bounds -- the merchant refuses to oversell a mandate
# --------------------------------------------------------------------------


def test_no_mandate_leaves_the_offer_unfitted():
    decision = evaluate(make_ctx(mandate=None))
    bounds = check(decision, "buyer_bounds")
    assert bounds.status is CheckStatus.PASS
    assert bounds.observed["mandate_present"] is False


def test_an_offer_over_the_buyers_per_txn_cap_is_not_made():
    decision = evaluate(make_ctx(mandate=make_mandate(per_txn_cap_paise=100_000)))
    assert decision.action is OfferAction.SUPPRESS
    bounds = check(decision, "buyer_bounds")
    assert bounds.status is CheckStatus.FAIL
    assert "per-transaction cap" in bounds.reason


def test_an_offer_beyond_the_buyers_remaining_budget_is_not_made():
    mandate = make_mandate(total_budget_paise=200_000, spent_paise=150_000)
    decision = evaluate(make_ctx(mandate=mandate))
    assert decision.action is OfferAction.SUPPRESS
    assert "left to spend" in check(decision, "buyer_bounds").reason


def test_a_bundle_may_not_smuggle_in_an_unauthorised_category():
    lines = [
        OfferLine(
            product_id="prod_a", title="Anchor", category="electronics", qty=1,
            unit_price_paise=100_000, line_total_paise=100_000, is_anchor=True,
        ),
        OfferLine(
            product_id="prod_b", title="Yoga Mat", category="fitness", qty=1,
            unit_price_paise=40_000, line_total_paise=40_000,
        ),
    ]
    decision = evaluate(make_ctx(lines=lines, mandate=make_mandate()))
    assert decision.action is OfferAction.SUPPRESS
    assert "fitness" in check(decision, "buyer_bounds").reason


def test_an_offer_inside_the_mandate_is_published():
    decision = evaluate(make_ctx(mandate=make_mandate()))
    assert decision.action is OfferAction.AUTO_PUBLISH


# --------------------------------------------------------------------------
# deep_discount_gate
# --------------------------------------------------------------------------


def test_a_deep_discount_is_gated_not_suppressed():
    decision = evaluate(
        make_ctx(campaign=make_campaign(deep_discount_gate_paise=5_000))
    )
    assert decision.action is OfferAction.GATE_FOR_HUMAN
    gate = check(decision, "deep_discount_gate")
    assert gate.status is CheckStatus.GATE
    # A gate is not a failure: everything before it passed.
    assert all(
        c.status is CheckStatus.PASS
        for c in decision.checks
        if c.id != "deep_discount_gate"
    )


def test_a_suppression_beats_a_gate():
    """A deep discount on an offer that also breaks the margin floor is refused outright."""
    decision = evaluate(
        make_ctx(
            cost_total_paise=129_000,
            campaign=make_campaign(deep_discount_gate_paise=5_000),
        )
    )
    assert decision.action is OfferAction.SUPPRESS


# --------------------------------------------------------------------------
# Short-circuit semantics
# --------------------------------------------------------------------------


def test_checks_after_a_failure_are_skipped_not_dropped():
    decision = evaluate(make_ctx(campaign=None))
    assert [c.id for c in decision.checks] == [cid for cid, _, _ in ORDERED_CHECKS]
    skipped = [c for c in decision.checks if c.status is CheckStatus.SKIPPED]
    assert len(skipped) == len(ORDERED_CHECKS) - 1
    for c in skipped:
        assert "campaign_active" in c.reason


def test_the_engine_never_touches_the_database():
    """A pure function is what makes every decision reproducible from its audit row."""
    import app.growth.engine as engine_module

    source = engine_module.__file__
    with open(source, encoding="utf-8") as fh:
        text = fh.read()
    for forbidden in ("from ..db import", "import sqlite3", "requests", "httpx"):
        assert forbidden not in text, f"the margin gauntlet must not reach for {forbidden}"


@pytest.mark.parametrize("check_id,_name,_fn", ORDERED_CHECKS)
def test_every_registered_check_is_covered_by_a_reason(check_id, _name, _fn):
    """Guards against a check being added to the gauntlet with no explanation path."""
    decision = evaluate(make_ctx())
    assert check(decision, check_id).reason
