"""Guardrail engine: one test per check, plus the ordering guarantees.

The engine is a pure function, so these need no database and no network -- a
context goes in, a decision comes out.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.models import CheckStatus, DecisionAction, MandateRecord, Product, iso, utcnow
from app.policy.engine import ORDERED_CHECKS, EvaluationContext, evaluate

MERCHANT = "merch_kirana_labs"


def make_mandate(
    *,
    per_txn_cap_paise: int = 300_000,
    total_budget_paise: int = 1_000_000,
    spent_paise: int = 0,
    reserved_paise: int = 0,
    allowed_categories: list[str] | None = None,
    merchant_id: str = MERCHANT,
    expires_in_hours: int = 24,
    revoked: bool = False,
) -> MandateRecord:
    now = utcnow()
    return MandateRecord(
        mandate_id="mdt_test",
        buyer_id="buyer_test",
        merchant_id=merchant_id,
        per_txn_cap_paise=per_txn_cap_paise,
        total_budget_paise=total_budget_paise,
        spent_paise=spent_paise,
        reserved_paise=reserved_paise,
        allowed_categories=allowed_categories or ["electronics", "office"],
        issued_at=iso(now),
        expires_at=iso(now + timedelta(hours=expires_in_hours)),
        revoked_at=iso(now) if revoked else None,
    )


def make_product(
    *, price_paise: int = 129_900, stock: int = 10, category: str = "electronics"
) -> Product:
    return Product(
        id="prod_test",
        title="Test Product",
        description="A product used only by the test suite.",
        category=category,
        price_paise=price_paise,
        currency="INR",
        stock=stock,
        attributes={},
    )


def make_ctx(**overrides) -> EvaluationContext:
    product = overrides.pop("product", make_product())
    qty = overrides.pop("qty", 1)
    defaults = {
        "merchant_id": MERCHANT,
        "product_id": product.id if product else "prod_missing",
        "qty": qty,
        "amount_paise": (product.price_paise * qty) if product else 0,
        "hitl_threshold_paise": 500_000,
        "max_qty_per_intent": 10,
        "mandate": make_mandate(),
        "product": product,
    }
    return EvaluationContext(**{**defaults, **overrides})


def check(decision, check_id):
    return next(c for c in decision.checks if c.id == check_id)


# --------------------------------------------------------------------- happy


def test_all_checks_pass_yields_auto_approve():
    decision = evaluate(make_ctx())
    assert decision.action == DecisionAction.AUTO_APPROVE
    assert all(c.status == CheckStatus.PASS for c in decision.checks)
    assert len(decision.checks) == len(ORDERED_CHECKS)


def test_every_check_carries_a_nonempty_reason():
    """The audit trail is built from these strings; a blank one is a bug."""
    decision = evaluate(make_ctx())
    for c in decision.checks:
        assert c.reason.strip(), f"check {c.id} returned an empty reason"


# ------------------------------------------------------------ check 1: mandate


def test_missing_mandate_denies():
    decision = evaluate(make_ctx(mandate=None, mandate_invalid_reason="Signature does not verify."))
    assert decision.action == DecisionAction.DENY
    assert check(decision, "mandate_valid").status == CheckStatus.FAIL
    assert "Signature does not verify." in decision.reasons[0]


def test_expired_mandate_denies():
    decision = evaluate(make_ctx(mandate=make_mandate(expires_in_hours=-1)))
    assert decision.action == DecisionAction.DENY
    assert "expired" in check(decision, "mandate_valid").reason.lower()


def test_revoked_mandate_denies():
    decision = evaluate(make_ctx(mandate=make_mandate(revoked=True)))
    assert decision.action == DecisionAction.DENY
    assert "revoked" in check(decision, "mandate_valid").reason.lower()


# ----------------------------------------------------------- check 2: merchant


def test_mandate_for_another_merchant_denies():
    decision = evaluate(make_ctx(mandate=make_mandate(merchant_id="merch_someone_else")))
    assert decision.action == DecisionAction.DENY
    assert check(decision, "merchant_match").status == CheckStatus.FAIL


# ------------------------------------------------------------ check 3: product


def test_unknown_product_denies():
    decision = evaluate(make_ctx(product=None))
    assert decision.action == DecisionAction.DENY
    assert check(decision, "product_exists").status == CheckStatus.FAIL


def test_quantity_above_the_ceiling_denies():
    decision = evaluate(make_ctx(qty=50))
    assert decision.action == DecisionAction.DENY
    assert "outside the permitted range" in check(decision, "product_exists").reason


def test_agent_cannot_name_its_own_price():
    """The merchant prices the order. A mismatched amount is refused outright."""
    product = make_product(price_paise=129_900)
    decision = evaluate(make_ctx(product=product, amount_paise=1))
    assert decision.action == DecisionAction.DENY
    assert "does not match the catalog price" in check(decision, "product_exists").reason


# ----------------------------------------------------------- check 4: category


def test_category_outside_allow_list_denies():
    decision = evaluate(make_ctx(product=make_product(category="fitness")))
    assert decision.action == DecisionAction.DENY
    failed = check(decision, "category_allowed")
    assert failed.status == CheckStatus.FAIL
    assert "fitness" in failed.reason


# -------------------------------------------------------- check 5: per-txn cap


def test_amount_above_per_transaction_cap_denies():
    decision = evaluate(
        make_ctx(product=make_product(price_paise=400_000), mandate=make_mandate(per_txn_cap_paise=300_000))
    )
    assert decision.action == DecisionAction.DENY
    assert check(decision, "per_txn_cap").status == CheckStatus.FAIL


def test_amount_exactly_at_the_cap_passes():
    """The cap is inclusive: 'up to' means the boundary is spendable."""
    decision = evaluate(
        make_ctx(product=make_product(price_paise=300_000), mandate=make_mandate(per_txn_cap_paise=300_000))
    )
    assert check(decision, "per_txn_cap").status == CheckStatus.PASS


# ----------------------------------------------------------- check 6: budget


def test_amount_above_remaining_budget_denies():
    mandate = make_mandate(total_budget_paise=200_000, spent_paise=150_000)
    decision = evaluate(make_ctx(product=make_product(price_paise=100_000), mandate=mandate))
    assert decision.action == DecisionAction.DENY
    failed = check(decision, "budget_remaining")
    assert failed.status == CheckStatus.FAIL
    assert failed.observed["available_paise"] == 50_000


def test_in_flight_reservations_count_against_the_budget():
    """Money held for a purchase that has not settled is not available to spend twice."""
    mandate = make_mandate(total_budget_paise=200_000, spent_paise=0, reserved_paise=150_000)
    decision = evaluate(make_ctx(product=make_product(price_paise=100_000), mandate=mandate))
    assert decision.action == DecisionAction.DENY
    assert check(decision, "budget_remaining").observed["available_paise"] == 50_000


def test_an_intents_own_reservation_is_not_counted_against_it():
    """Re-evaluating a gated intent must not charge it for its own hold."""
    mandate = make_mandate(total_budget_paise=200_000, reserved_paise=100_000)
    decision = evaluate(
        make_ctx(
            product=make_product(price_paise=100_000),
            mandate=mandate,
            self_reserved_paise=100_000,
        )
    )
    assert check(decision, "budget_remaining").status == CheckStatus.PASS


# ------------------------------------------------------------- check 7: stock


def test_out_of_stock_denies():
    decision = evaluate(make_ctx(product=make_product(stock=0)))
    assert decision.action == DecisionAction.DENY
    assert check(decision, "stock_available").status == CheckStatus.FAIL


def test_insufficient_stock_for_the_quantity_denies():
    # Cap and budget are set wide so that stock is the check that has to catch
    # this; otherwise per_txn_cap fires first and stock is never reached.
    decision = evaluate(
        make_ctx(
            product=make_product(stock=2),
            qty=5,
            mandate=make_mandate(per_txn_cap_paise=1_000_000, total_budget_paise=2_000_000),
            hitl_threshold_paise=2_000_000,
        )
    )
    assert decision.action == DecisionAction.DENY
    failed = check(decision, "stock_available")
    assert failed.status == CheckStatus.FAIL
    assert failed.observed == {"stock": 2, "qty": 5}


# -------------------------------------------------------- check 8: human gate


def test_high_value_purchase_is_gated_not_denied():
    decision = evaluate(
        make_ctx(
            product=make_product(price_paise=600_000),
            mandate=make_mandate(per_txn_cap_paise=900_000),
        )
    )
    assert decision.action == DecisionAction.GATE_FOR_HUMAN
    assert check(decision, "high_value_gate").status == CheckStatus.GATE
    # Everything before the gate still passed -- a gate is not a failure.
    assert all(
        c.status == CheckStatus.PASS for c in decision.checks if c.id != "high_value_gate"
    )


def test_amount_exactly_at_the_threshold_is_gated():
    decision = evaluate(
        make_ctx(
            product=make_product(price_paise=500_000),
            mandate=make_mandate(per_txn_cap_paise=900_000),
            hitl_threshold_paise=500_000,
        )
    )
    assert decision.action == DecisionAction.GATE_FOR_HUMAN


def test_a_denial_outranks_a_gate():
    """A high-value purchase that also breaches a bound is denied, never gated."""
    decision = evaluate(
        make_ctx(
            product=make_product(price_paise=600_000, category="fitness"),
            mandate=make_mandate(per_txn_cap_paise=900_000),
        )
    )
    assert decision.action == DecisionAction.DENY


# ------------------------------------------------------------------ ordering


def test_checks_run_in_the_declared_order():
    decision = evaluate(make_ctx())
    assert [c.id for c in decision.checks] == [cid for cid, _, _ in ORDERED_CHECKS]


def test_checks_after_a_failure_are_recorded_as_skipped():
    """The trail must show how far evaluation got, not silently drop the rest."""
    decision = evaluate(make_ctx(mandate=make_mandate(merchant_id="merch_other")))
    statuses = {c.id: c.status for c in decision.checks}
    assert statuses["merchant_match"] == CheckStatus.FAIL
    assert statuses["per_txn_cap"] == CheckStatus.SKIPPED
    assert statuses["high_value_gate"] == CheckStatus.SKIPPED
    skipped = next(c for c in decision.checks if c.status == CheckStatus.SKIPPED)
    assert "merchant_match" in skipped.reason


def test_the_first_failure_is_the_reported_reason():
    """Two problems at once: the agent is told about the first one, not a jumble."""
    decision = evaluate(
        make_ctx(
            product=make_product(category="fitness", price_paise=900_000),
            mandate=make_mandate(per_txn_cap_paise=300_000),
        )
    )
    assert len(decision.reasons) == 1
    assert "fitness" in decision.reasons[0]


@pytest.mark.parametrize("action", list(DecisionAction))
def test_only_auto_approve_permits_payment(action):
    """`allows_payment` is what the payment service gates on. It must be strict."""
    from app.models import Decision

    decision = Decision(action=action, reasons=[], checks=[], evaluated_at=iso(utcnow()))
    assert decision.allows_payment == (action == DecisionAction.AUTO_APPROVE)
