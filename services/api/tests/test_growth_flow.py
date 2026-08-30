"""The growth layer end to end: quote, accept, settle, attribute, orchestrate.

These go through the real service and the real database, unlike the pure-function
tests in `test_growth_engine.py`. What they are really pinning down is the money:
a discount that is held, given away, or returned, and the revenue attributed to
the growth agent measured against a counterfactual rather than asserted.
"""

from __future__ import annotations

from app.catalog import store as catalog
from app.config import get_settings
from app.db import connect, transaction
from app.growth import attribution, campaigns, economics
from app.growth import service as growth
from app.intents import service as intents
from app.mandate import service as mandates
from app.models import (
    MandateIssueRequest,
    OfferStatus,
    PurchaseIntentRequest,
)
from app.payments import service as payments

from .conftest import MOUSE, YOGA_MAT

COFFEE_KIT = "prod_home_003"     # INR 1,799, home_kitchen (roomier margin)
CHAIR = "prod_offc_005"          # INR 12,499, drives a deep-discount gate


def issue(**over) -> str:
    base = dict(
        buyer_id="buyer_growth",
        merchant_id=get_settings().merchant_id,
        per_txn_cap_paise=300_000,
        total_budget_paise=1_000_000,
        allowed_categories=["electronics", "office"],
        ttl_hours=24,
    )
    base.update(over)
    return mandates.issue(MandateIssueRequest(**base)).mandate_token


def published_bundle(product_id=MOUSE, mandate=None):
    response = growth.quote_offers(product_id, mandate)
    return next((o for o in response.offers if o.kind.value == "bundle"), None)


# --------------------------------------------------------------------------
# Quoting
# --------------------------------------------------------------------------


def test_offers_are_published_for_a_normal_product():
    response = growth.quote_offers(MOUSE)
    assert response.offers, "the growth agent should find something to offer on a mouse"
    for offer in response.offers:
        assert offer.offer_total_paise == offer.list_total_paise - offer.discount_paise
        assert offer.disclosure, "an offer with no disclosure is not explainable"


def test_a_suppressed_offer_is_named_not_hidden():
    """An agent that asked deserves to know an offer existed and why it is refused."""
    response = growth.quote_offers(MOUSE)
    assert response.withheld
    for w in response.withheld:
        assert w["failed_check"]
        assert w["reason"]


def test_offers_reconcile_against_the_live_catalog():
    response = growth.quote_offers(MOUSE)
    for offer in response.offers:
        for line in offer.lines:
            product = catalog.get_product(line.product_id)
            assert line.unit_price_paise == product.price_paise
            assert line.line_total_paise == product.price_paise * line.qty
        assert sum(x.line_total_paise for x in offer.lines) == offer.list_total_paise


def test_cost_price_never_appears_in_an_agent_facing_offer():
    """The one number that must not cross the counter."""
    response = growth.quote_offers(MOUSE)
    blob = response.model_dump_json()
    for product_id in (MOUSE,):
        cost = economics.get_cost_paise(product_id)
        assert str(cost) not in blob, "cost price leaked into an agent-facing payload"
    assert "cost" not in blob.lower()


def test_a_tight_mandate_shrinks_what_is_offered():
    """Budget-aware merchandising: the merchant will not oversell a mandate."""
    tight = mandates.issue(
        MandateIssueRequest(
            buyer_id="buyer_tight",
            merchant_id=get_settings().merchant_id,
            per_txn_cap_paise=140_000,
            total_budget_paise=400_000,
            allowed_categories=["electronics"],
            ttl_hours=24,
        )
    ).mandate

    unfitted = growth.quote_offers(MOUSE, None)
    fitted = growth.quote_offers(MOUSE, tight)

    assert unfitted.mandate_aware is False
    assert fitted.mandate_aware is True
    assert len(fitted.offers) < len(unfitted.offers)
    assert any(w["failed_check"] == "buyer_bounds" for w in fitted.withheld)


def test_publishing_holds_the_discount_against_the_campaign():
    before = campaigns.active_campaign()
    assert before.discount_reserved_paise == 0
    response = growth.quote_offers(MOUSE)
    after = campaigns.active_campaign()
    expected = sum(o.discount_paise for o in response.offers)
    assert after.discount_reserved_paise == expected
    assert after.discount_spent_paise == 0, "nothing is given away until a payment settles"


def test_a_suppressed_offer_holds_no_budget():
    growth.quote_offers(MOUSE)
    ledger = growth.list_offers(limit=50)
    for evaluated in ledger:
        if evaluated.offer.status is OfferStatus.SUPPRESSED:
            with connect() as conn:
                row = conn.execute(
                    "SELECT reserved_paise FROM offer WHERE offer_id = ?",
                    (evaluated.offer.offer_id,),
                ).fetchone()
            assert row["reserved_paise"] == 0


# --------------------------------------------------------------------------
# Accepting an offer through the buy-side gauntlet
# --------------------------------------------------------------------------


def test_accepting_an_offer_prices_the_intent_from_the_offer():
    token = issue()
    offer = published_bundle()
    result = intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token, product_id=MOUSE, qty=1, offer_id=offer.offer_id
        )
    )
    assert result.decision.action.value == "auto_approve"
    assert result.intent.amount_paise == offer.offer_total_paise
    assert result.intent.list_amount_paise == offer.list_total_paise
    assert result.intent.discount_paise == offer.discount_paise


def test_the_offer_honoured_check_runs_on_every_intent():
    token = issue()
    result = intents.create_intent(
        PurchaseIntentRequest(mandate_token=token, product_id=MOUSE, qty=1)
    )
    check = next(c for c in result.decision.checks if c.id == "offer_honoured")
    assert check.status.value == "pass"
    assert check.observed["offer_attached"] is False


def test_an_unknown_offer_id_is_denied():
    token = issue()
    result = intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token, product_id=MOUSE, qty=1, offer_id="ofr_does_not_exist"
        )
    )
    assert result.decision.action.value == "deny"
    check = next(c for c in result.decision.checks if c.id == "offer_honoured")
    assert check.status.value == "fail"


def test_an_offer_cannot_be_repriced_after_publication():
    """The merchant may make an offer; it may not change one already taken up."""
    token = issue()
    offer = published_bundle()
    complement = next(line for line in offer.lines if not line.is_anchor)
    catalog.set_stock(complement.product_id, 50)
    with transaction() as conn:
        conn.execute(
            "UPDATE product SET price_paise = price_paise + 50000 WHERE id = ?",
            (complement.product_id,),
        )
    catalog.invalidate_index()

    result = intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token, product_id=MOUSE, qty=1, offer_id=offer.offer_id
        )
    )
    assert result.decision.action.value == "deny"
    check = next(c for c in result.decision.checks if c.id == "offer_honoured")
    assert "not honoured at the old price" in check.reason


def test_an_accepted_offer_cannot_be_taken_twice():
    token = issue()
    offer = published_bundle()
    intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token, product_id=MOUSE, qty=1, offer_id=offer.offer_id
        )
    )
    second = intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token, product_id=MOUSE, qty=1, offer_id=offer.offer_id
        )
    )
    assert second.decision.action.value == "deny"


def test_a_bundle_cannot_widen_a_mandates_categories():
    """The buy-side gauntlet checks every line, not just the anchor."""
    from app.models import OfferKind, OfferLine, OfferQuote
    from app.policy.engine import EvaluationContext
    from app.policy.engine import evaluate as policy_evaluate

    mandate = mandates.issue(
        MandateIssueRequest(
            buyer_id="buyer_narrow",
            merchant_id=get_settings().merchant_id,
            per_txn_cap_paise=300_000,
            total_budget_paise=1_000_000,
            allowed_categories=["electronics"],
            ttl_hours=24,
        )
    ).mandate

    mouse = catalog.get_product(MOUSE)
    mat = catalog.get_product(YOGA_MAT)
    offer = OfferQuote(
        offer_id="ofr_mixed", campaign_id="cmp_test", kind=OfferKind.BUNDLE,
        anchor_product_id=MOUSE,
        lines=[
            OfferLine(product_id=mouse.id, title=mouse.title, category=mouse.category,
                      qty=1, unit_price_paise=mouse.price_paise,
                      line_total_paise=mouse.price_paise, is_anchor=True),
            OfferLine(product_id=mat.id, title=mat.title, category=mat.category,
                      qty=1, unit_price_paise=mat.price_paise,
                      line_total_paise=mat.price_paise),
        ],
        list_total_paise=mouse.price_paise + mat.price_paise,
        offer_total_paise=mouse.price_paise + mat.price_paise - 10_000,
        discount_paise=10_000, discount_bps=385,
        headline="mixed", rationale="r", disclosure="d",
        expires_at="2099-01-01T00:00:00Z",
    )
    decision = policy_evaluate(
        EvaluationContext(
            merchant_id=get_settings().merchant_id, product_id=MOUSE, qty=1,
            amount_paise=offer.offer_total_paise, hitl_threshold_paise=500_000,
            max_qty_per_intent=10, mandate=mandate, product=mouse, offer=offer,
            offer_line_products={mouse.id: mouse, mat.id: mat},
        )
    )
    assert decision.action.value == "deny"
    check = next(c for c in decision.checks if c.id == "category_allowed")
    assert "fitness" in check.reason


# --------------------------------------------------------------------------
# Settlement: the discount ledger
# --------------------------------------------------------------------------


def pay(intent_id, token):
    checkout = payments.start_checkout(intent_id=intent_id, mandate_token=token)
    return payments.simulate_payment(
        payment_link_id=checkout.payment.rzp_payment_link_id, outcome="success"
    )


def test_a_settled_payment_gives_the_discount_away():
    token = issue()
    offer = published_bundle()
    result = intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token, product_id=MOUSE, qty=1, offer_id=offer.offer_id
        )
    )
    pay(result.intent.intent_id, token)

    campaign = campaigns.active_campaign()
    assert campaign.discount_spent_paise == offer.discount_paise
    stored = growth.get_offer(offer.offer_id)
    assert stored.offer.status is OfferStatus.ACCEPTED


def test_a_failed_payment_returns_the_discount():
    """A charge that never lands must not consume the campaign's budget."""
    token = issue()
    offer = published_bundle()
    result = intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token, product_id=MOUSE, qty=1, offer_id=offer.offer_id
        )
    )
    checkout = payments.start_checkout(
        intent_id=result.intent.intent_id, mandate_token=token
    )
    before = campaigns.active_campaign().discount_reserved_paise
    assert before >= offer.discount_paise

    payments.simulate_payment(
        payment_link_id=checkout.payment.rzp_payment_link_id, outcome="failure"
    )
    campaign = campaigns.active_campaign()
    assert campaign.discount_spent_paise == 0
    assert campaign.discount_reserved_paise == before - offer.discount_paise


def test_declining_an_offer_frees_its_discount():
    response = growth.quote_offers(MOUSE)
    offer = response.offers[0]
    held = campaigns.active_campaign().discount_reserved_paise
    growth.decline(offer.offer_id)
    after = campaigns.active_campaign()
    assert after.discount_reserved_paise == held - offer.discount_paise
    assert growth.get_offer(offer.offer_id).offer.status is OfferStatus.DECLINED


def test_a_settled_bundle_takes_stock_off_every_line():
    token = issue()
    offer = published_bundle()
    before = {
        line.product_id: catalog.get_product(line.product_id).stock for line in offer.lines
    }
    result = intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token, product_id=MOUSE, qty=1, offer_id=offer.offer_id
        )
    )
    pay(result.intent.intent_id, token)
    for line in offer.lines:
        after = catalog.get_product(line.product_id).stock
        assert after == before[line.product_id] - line.qty, (
            f"{line.product_id} did not have its stock consumed"
        )


# --------------------------------------------------------------------------
# The human gate on a deep discount
# --------------------------------------------------------------------------


def test_a_deep_discount_is_gated_and_holds_its_budget():
    response = growth.quote_offers(CHAIR)
    gated = [w for w in response.withheld if w["failed_check"] == "deep_discount_gate"]
    assert gated, "a bundle on a INR 12,499 chair should cross the review threshold"
    stored = growth.get_offer(gated[0]["offer_id"])
    assert stored.offer.status is OfferStatus.GATED
    # Held, not given: a human deciding must not let a second offer overcommit.
    assert campaigns.active_campaign().discount_reserved_paise >= stored.offer.discount_paise


def test_approving_a_gate_rechecks_every_other_guardrail():
    response = growth.quote_offers(CHAIR)
    gated = next(w for w in response.withheld if w["failed_check"] == "deep_discount_gate")
    resolved = growth.resolve_gate(gated["offer_id"], approve=True, resolved_by="tester")
    assert resolved.offer.status is OfferStatus.PUBLISHED
    assert [c.id for c in resolved.decision.checks]


def test_a_human_cannot_waive_the_margin_floor():
    """Approving a gate waives the depth of the discount, nothing else."""
    response = growth.quote_offers(CHAIR)
    gated = next(w for w in response.withheld if w["failed_check"] == "deep_discount_gate")
    stored = growth.get_offer(gated["offer_id"])
    # Push cost above the offer total so the margin floor must now refuse it.
    for line in stored.offer.lines:
        economics.set_cost_paise(line.product_id, line.unit_price_paise)

    resolved = growth.resolve_gate(gated["offer_id"], approve=True, resolved_by="tester")
    assert resolved.offer.status is OfferStatus.SUPPRESSED
    assert campaigns.active_campaign().discount_reserved_paise == 0


def test_rejecting_a_gate_releases_the_hold():
    response = growth.quote_offers(CHAIR)
    gated = next(w for w in response.withheld if w["failed_check"] == "deep_discount_gate")
    growth.resolve_gate(gated["offer_id"], approve=False, resolved_by="tester")
    assert growth.get_offer(gated["offer_id"]).offer.status is OfferStatus.SUPPRESSED
    assert campaigns.active_campaign().discount_reserved_paise == 0


# --------------------------------------------------------------------------
# Attribution
# --------------------------------------------------------------------------


def test_uplift_is_measured_against_a_counterfactual():
    token = issue()
    offer = published_bundle()
    result = intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token, product_id=MOUSE, qty=1, offer_id=offer.offer_id
        )
    )
    pay(result.intent.intent_id, token)

    metrics = attribution.revenue_metrics()
    anchor_price = catalog.get_product(MOUSE).price_paise
    assert metrics.settled_gmv_paise == offer.offer_total_paise
    assert metrics.baseline_gmv_paise == anchor_price
    assert metrics.uplift_paise == offer.offer_total_paise - anchor_price
    assert metrics.uplift_paise > 0
    assert metrics.attach_rate_bps == 10000


def test_a_published_but_unaccepted_offer_earns_nothing():
    """Impressions are not revenue."""
    growth.quote_offers(MOUSE)
    metrics = attribution.revenue_metrics()
    assert metrics.settled_gmv_paise == 0
    assert metrics.uplift_paise == 0
    assert metrics.offers_published >= 1


def test_an_unpaid_acceptance_earns_nothing():
    token = issue()
    offer = published_bundle()
    intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token, product_id=MOUSE, qty=1, offer_id=offer.offer_id
        )
    )
    metrics = attribution.revenue_metrics()
    assert metrics.settled_gmv_paise == 0, "only a verified settlement counts"


def test_margin_protected_counts_the_discount_the_gauntlet_refused():
    growth.quote_offers(MOUSE)
    metrics = attribution.revenue_metrics()
    ledger = growth.list_offers(limit=100, status=OfferStatus.SUPPRESSED.value)
    assert metrics.margin_protected_paise == sum(
        e.offer.discount_paise for e in ledger
    )
    assert metrics.margin_protected_paise > 0


def test_an_ordinary_purchase_has_no_uplift_and_no_attach():
    token = issue()
    result = intents.create_intent(
        PurchaseIntentRequest(mandate_token=token, product_id=MOUSE, qty=1)
    )
    pay(result.intent.intent_id, token)
    metrics = attribution.revenue_metrics()
    assert metrics.uplift_paise == 0
    assert metrics.attach_rate_bps == 0
    assert metrics.aov_without_offer_paise == catalog.get_product(MOUSE).price_paise


# --------------------------------------------------------------------------
# Orchestrator
# --------------------------------------------------------------------------


def test_rebalance_explains_every_move():
    result = growth.rebalance()
    assert result.evaluated > 0
    for move in result.moves:
        assert move.action in ("promote", "withdraw", "hold")
        assert len(move.reason) > 20
        assert move.observed


def test_rebalance_withdraws_thin_stock():
    catalog.set_stock(MOUSE, 2)
    result = growth.rebalance()
    move = next((m for m in result.moves if m.product_id == MOUSE), None)
    assert move is not None
    assert move.action == "withdraw"
    assert "Only 2 left" in move.reason


def test_rebalance_withdraws_thin_margin():
    product = catalog.get_product(COFFEE_KIT)
    economics.set_cost_paise(COFFEE_KIT, int(product.price_paise * 0.99))
    result = growth.rebalance()
    move = next((m for m in result.moves if m.product_id == COFFEE_KIT), None)
    assert move is not None
    assert move.action == "withdraw"
    assert "under the campaign" in move.reason


def test_rebalance_lands_on_the_audit_chain():
    from app.audit import log as audit

    before = audit.verify_chain().length
    growth.rebalance()
    after = audit.verify_chain()
    assert after.length == before + 1
    assert after.valid


# --------------------------------------------------------------------------
# Economics
# --------------------------------------------------------------------------


def test_derived_costs_are_deterministic():
    """Two judges running this get identical numbers."""
    a = economics.derive_cost_paise("prod_x", "electronics", 100_000)
    b = economics.derive_cost_paise("prod_x", "electronics", 100_000)
    assert a == b
    assert a < 100_000


def test_categories_carry_different_margins():
    electronics = economics.baseline_margin_bps("prod_same", "electronics")
    fitness = economics.baseline_margin_bps("prod_same", "fitness")
    assert fitness > electronics, "fitness should carry more room than thin electronics"


def test_seeding_economics_is_idempotent():
    first = economics.seed_economics()
    second = economics.seed_economics()
    assert first["inserted"] == 0 or second["inserted"] == 0


def test_every_catalogued_product_has_a_cost():
    with connect() as conn:
        missing = conn.execute(
            "SELECT COUNT(*) FROM product p "
            "LEFT JOIN product_economics e ON e.product_id = p.id "
            "WHERE e.product_id IS NULL"
        ).fetchone()[0]
    assert missing == 0


# --------------------------------------------------------------------------
# The buyer agent as a fiduciary
# --------------------------------------------------------------------------


def test_the_agent_declines_a_bundle_it_was_not_asked_for():
    """A saving is not authority. The agent was asked for one thing."""
    from app.agent import buyer

    token = issue()
    result = buyer.run_goal(goal="buy a wireless mouse", mandate_token=token, auto_pay=False)
    step = next((s for s in result.steps if s.action == "consider_offers"), None)
    assert step is not None, "the agent should have asked the merchant for offers"

    bundles = [
        o for o in step.detail["offers_considered"] if o["kind"] == "bundle"
    ]
    assert bundles, "a bundle should have been on the table"
    assert all(not o["accepted"] for o in bundles)
    assert "no authority" in " ".join(o["reason"] for o in bundles)


def test_a_declined_offer_returns_its_discount_to_the_campaign():
    from app.agent import buyer

    token = issue()
    buyer.run_goal(goal="buy a wireless mouse", mandate_token=token, auto_pay=False)
    declined = growth.list_offers(limit=50, status=OfferStatus.DECLINED.value)
    assert declined, "declining should be recorded, not silent"
    for evaluated in declined:
        with connect() as conn:
            row = conn.execute(
                "SELECT reserved_paise FROM offer WHERE offer_id = ?",
                (evaluated.offer.offer_id,),
            ).fetchone()
        assert row["reserved_paise"] == 0


def test_the_agent_honours_a_price_ceiling_in_its_instruction():
    """A better product is not worth ignoring the limit the human gave."""
    from app.agent import buyer

    token = issue()
    result = buyer.run_goal(
        goal="buy a wireless mouse under 1400", mandate_token=token, auto_pay=False
    )
    step = next((s for s in result.steps if s.action == "consider_offers"), None)
    if step is None:
        return  # nothing was offered; the ceiling was never tested
    upgrades = [o for o in step.detail["offers_considered"] if o["kind"] == "upgrade"]
    for offer in upgrades:
        if offer["offer_total_paise"] > 140_000:
            assert not offer["accepted"]
            assert "ceiling" in offer["reason"]


def test_an_accepted_upgrade_records_the_product_actually_bought():
    """An upgrade replaces the anchor, so the ledger must say what shipped."""
    token = issue()
    response = growth.quote_offers(MOUSE, None)
    upgrade = next((o for o in response.offers if o.kind.value == "upgrade"), None)
    if upgrade is None:
        return

    result = intents.create_intent(
        PurchaseIntentRequest(
            mandate_token=token, product_id=MOUSE, qty=1, offer_id=upgrade.offer_id
        )
    )
    assert result.decision.action.value == "auto_approve"
    # The intent names the upgrade, not the mouse the agent searched for.
    assert result.intent.product_id == upgrade.lines[0].product_id
    assert result.intent.product_id != MOUSE
    assert result.intent.amount_paise == upgrade.offer_total_paise


def test_no_offers_are_made_on_an_out_of_stock_anchor():
    catalog.set_stock(MOUSE, 0)
    response = growth.quote_offers(MOUSE)
    assert response.offers == []
    assert response.withheld[0]["failed_check"] == "stock_cover"
