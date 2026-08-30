"""The guardrail engine.

Every purchase intent passes through `evaluate()` before any money can move.
There is no other path to the payment service.

The engine is deliberately a *pure function*: it takes an already-assembled
context and returns a `Decision`. It never reads the database and never calls
Razorpay, which is what makes each of the nine checks unit-testable in isolation
and makes the outcome reproducible from the audit payload alone.

Three checks are offer-aware. When a buyer accepts a merchant offer, the offer --
not the anchor's list price -- is what is owed, every line in it must sit inside
the mandate's categories, and every line must be in stock. A bundle is the obvious
way to try to widen a mandate's scope, so that route is explicitly closed.

Checks run in a fixed order, cheapest and most fundamental first. The first
failure denies the intent and the remaining checks are recorded as `skipped`
rather than silently dropped, so the audit trail shows exactly how far
evaluation got and why it stopped.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ..models import (
    CheckStatus,
    Decision,
    DecisionAction,
    MandateRecord,
    OfferQuote,
    PolicyCheck,
    Product,
    iso,
    utcnow,
)

POLICY_VERSION = "vyapaar.policy.v1"


def _inr(paise: int) -> str:
    return f"INR {paise / 100:,.2f}"


@dataclass(frozen=True)
class EvaluationContext:
    """Everything the engine is allowed to know. Assembled by the intent service."""

    merchant_id: str
    product_id: str
    qty: int
    amount_paise: int
    hitl_threshold_paise: int
    max_qty_per_intent: int
    mandate: MandateRecord | None = None
    mandate_invalid_reason: str | None = None
    product: Product | None = None
    # A merchant offer the buyer chose to accept, already re-verified server-side by
    # the growth layer. When present it -- not the anchor's list price -- is what the
    # buyer owes, and every line in it is subject to the same category and stock
    # checks the anchor is.
    offer: OfferQuote | None = None
    offer_invalid_reason: str | None = None
    offer_line_products: dict[str, Product] = field(default_factory=dict)
    # Budget already committed by *this* intent, if it is being re-evaluated after
    # a human approved a gate. Excluded from the remaining-budget arithmetic so an
    # intent is not charged against its own reservation twice.
    self_reserved_paise: int = 0
    extra: dict[str, Any] = field(default_factory=dict)


CheckFn = Callable[[EvaluationContext], PolicyCheck]


# --------------------------------------------------------------------------
# Individual checks
# --------------------------------------------------------------------------


def check_mandate_valid(ctx: EvaluationContext) -> PolicyCheck:
    if ctx.mandate is None:
        return PolicyCheck(
            id="mandate_valid",
            name="Mandate is signed, unexpired and on record",
            status=CheckStatus.FAIL,
            reason=ctx.mandate_invalid_reason or "No valid mandate was presented with this intent.",
            observed={"mandate_present": False},
        )
    if ctx.mandate.is_expired:
        return PolicyCheck(
            id="mandate_valid",
            name="Mandate is signed, unexpired and on record",
            status=CheckStatus.FAIL,
            reason=f"Mandate {ctx.mandate.mandate_id} expired at {ctx.mandate.expires_at}.",
            observed={"expires_at": ctx.mandate.expires_at},
        )
    if ctx.mandate.revoked_at is not None:
        return PolicyCheck(
            id="mandate_valid",
            name="Mandate is signed, unexpired and on record",
            status=CheckStatus.FAIL,
            reason=f"Mandate {ctx.mandate.mandate_id} was revoked at {ctx.mandate.revoked_at}.",
            observed={"revoked_at": ctx.mandate.revoked_at},
        )
    return PolicyCheck(
        id="mandate_valid",
        name="Mandate is signed, unexpired and on record",
        status=CheckStatus.PASS,
        reason=(
            f"Mandate {ctx.mandate.mandate_id} verified for buyer {ctx.mandate.buyer_id}; "
            f"valid until {ctx.mandate.expires_at}."
        ),
        observed={
            "mandate_id": ctx.mandate.mandate_id,
            "buyer_id": ctx.mandate.buyer_id,
            "expires_at": ctx.mandate.expires_at,
        },
    )


def check_merchant_match(ctx: EvaluationContext) -> PolicyCheck:
    assert ctx.mandate is not None
    if ctx.mandate.merchant_id != ctx.merchant_id:
        return PolicyCheck(
            id="merchant_match",
            name="Intent targets the merchant the mandate names",
            status=CheckStatus.FAIL,
            reason=(
                f"Mandate authorises spending at {ctx.mandate.merchant_id}, but this intent "
                f"targets {ctx.merchant_id}. A mandate is not transferable between merchants."
            ),
            observed={"mandate_merchant": ctx.mandate.merchant_id, "intent_merchant": ctx.merchant_id},
        )
    return PolicyCheck(
        id="merchant_match",
        name="Intent targets the merchant the mandate names",
        status=CheckStatus.PASS,
        reason=f"Intent and mandate both bind to merchant {ctx.merchant_id}.",
        observed={"merchant_id": ctx.merchant_id},
    )


def check_offer_honoured(ctx: EvaluationContext) -> PolicyCheck:
    """If the buyer accepted a merchant offer, that offer must still stand.

    The merchant is allowed to make offers; it is not allowed to change one after
    an agent has decided to take it. The growth layer re-fetches the offer from its
    own records and re-prices it against the live catalog, and any drift lands here
    as a denial rather than as a surprise on the invoice.

    Passing trivially when no offer is attached keeps the ordinary path unchanged.
    """
    if ctx.offer is None:
        if ctx.offer_invalid_reason:
            return PolicyCheck(
                id="offer_honoured",
                name="Any accepted offer still stands",
                status=CheckStatus.FAIL,
                reason=ctx.offer_invalid_reason,
                observed={"offer_attached": True, "offer_resolved": False},
            )
        return PolicyCheck(
            id="offer_honoured",
            name="Any accepted offer still stands",
            status=CheckStatus.PASS,
            reason="No merchant offer was accepted; the buyer pays the catalog price.",
            observed={"offer_attached": False},
        )

    if ctx.offer_invalid_reason:
        return PolicyCheck(
            id="offer_honoured",
            name="Any accepted offer still stands",
            status=CheckStatus.FAIL,
            reason=ctx.offer_invalid_reason,
            observed={"offer_id": ctx.offer.offer_id},
        )

    offer = ctx.offer
    if offer.list_total_paise - offer.discount_paise != offer.offer_total_paise:
        return PolicyCheck(
            id="offer_honoured",
            name="Any accepted offer still stands",
            status=CheckStatus.FAIL,
            reason=(
                f"Offer {offer.offer_id} does not reconcile: {_inr(offer.list_total_paise)} "
                f"minus {_inr(offer.discount_paise)} is not {_inr(offer.offer_total_paise)}."
            ),
            observed={"offer_id": offer.offer_id},
        )
    return PolicyCheck(
        id="offer_honoured",
        name="Any accepted offer still stands",
        status=CheckStatus.PASS,
        reason=(
            f"Offer {offer.offer_id} ({offer.kind.value}) is live and still prices at "
            f"{_inr(offer.offer_total_paise)}, {_inr(offer.discount_paise)} off "
            f"{_inr(offer.list_total_paise)} list."
        ),
        observed={
            "offer_id": offer.offer_id,
            "kind": offer.kind.value,
            "offer_total_paise": offer.offer_total_paise,
            "discount_paise": offer.discount_paise,
        },
    )


def check_product_exists(ctx: EvaluationContext) -> PolicyCheck:
    if ctx.product is None:
        return PolicyCheck(
            id="product_exists",
            name="Product exists in the merchant catalog",
            status=CheckStatus.FAIL,
            reason=f"No product with id {ctx.product_id} is listed by this merchant.",
            observed={"product_id": ctx.product_id},
        )
    if ctx.qty < 1 or ctx.qty > ctx.max_qty_per_intent:
        return PolicyCheck(
            id="product_exists",
            name="Product exists in the merchant catalog",
            status=CheckStatus.FAIL,
            reason=(
                f"Quantity {ctx.qty} is outside the permitted range 1..{ctx.max_qty_per_intent} "
                "for a single agent-initiated intent."
            ),
            observed={"qty": ctx.qty, "max_qty_per_intent": ctx.max_qty_per_intent},
        )
    # With an offer attached, the merchant's quoted offer total is what is owed --
    # already proven to reconcile against catalog prices by the growth gauntlet and
    # re-proven by `offer_honoured` above.
    expected = ctx.offer.offer_total_paise if ctx.offer else ctx.product.price_paise * ctx.qty
    if expected != ctx.amount_paise:
        return PolicyCheck(
            id="product_exists",
            name="Product exists in the merchant catalog",
            status=CheckStatus.FAIL,
            reason=(
                f"Amount {_inr(ctx.amount_paise)} does not match "
                + (
                    f"offer {ctx.offer.offer_id}'s total of {_inr(expected)}. "
                    if ctx.offer
                    else f"the catalog price {_inr(ctx.product.price_paise)} x {ctx.qty} = "
                    f"{_inr(expected)}. "
                )
                + "The merchant prices the order, not the agent."
            ),
            observed={"claimed_amount_paise": ctx.amount_paise, "catalog_amount_paise": expected},
        )
    return PolicyCheck(
        id="product_exists",
        name="Product exists in the merchant catalog",
        status=CheckStatus.PASS,
        reason=(
            (
                f"Offer {ctx.offer.offer_id} covers {len(ctx.offer.lines)} line(s) totalling "
                f"{_inr(ctx.amount_paise)}, priced by the merchant."
            )
            if ctx.offer
            else (
                f"{ctx.product.title} is listed at {_inr(ctx.product.price_paise)}; "
                f"{ctx.qty} x = {_inr(ctx.amount_paise)}, priced by the merchant."
            )
        ),
        observed={
            "product_id": ctx.product.id,
            "unit_price_paise": ctx.product.price_paise,
            "qty": ctx.qty,
            "amount_paise": ctx.amount_paise,
        },
    )


def check_category_allowed(ctx: EvaluationContext) -> PolicyCheck:
    """Every line has to be authorised, not just the one the agent went looking for.

    A bundle is the obvious way to smuggle an unauthorised category into an order,
    so with an offer attached the check runs over all of its lines rather than over
    the anchor alone.
    """
    assert ctx.mandate is not None and ctx.product is not None
    allowed = ctx.mandate.allowed_categories

    if ctx.offer is not None:
        offending = [line for line in ctx.offer.lines if line.category not in allowed]
        categories = sorted({line.category for line in ctx.offer.lines})
        if offending:
            names = ", ".join(f"{line.title} ({line.category})" for line in offending)
            return PolicyCheck(
                id="category_allowed",
                name="Product category is inside the mandate allow-list",
                status=CheckStatus.FAIL,
                reason=(
                    f"Offer {ctx.offer.offer_id} includes {names}, which the buyer did not "
                    f"authorise. The mandate permits only {allowed}. A bundle cannot widen "
                    "a mandate's scope."
                ),
                observed={"offer_categories": categories, "allowed_categories": allowed},
            )
        return PolicyCheck(
            id="category_allowed",
            name="Product category is inside the mandate allow-list",
            status=CheckStatus.PASS,
            reason=(
                f"Every category in the offer {categories} is on the mandate allow-list "
                f"{allowed}."
            ),
            observed={"offer_categories": categories, "allowed_categories": allowed},
        )

    if ctx.product.category not in allowed:
        return PolicyCheck(
            id="category_allowed",
            name="Product category is inside the mandate allow-list",
            status=CheckStatus.FAIL,
            reason=(
                f"'{ctx.product.title}' is in category '{ctx.product.category}', which the buyer "
                f"did not authorise. The mandate permits only {allowed}."
            ),
            observed={"product_category": ctx.product.category, "allowed_categories": allowed},
        )
    return PolicyCheck(
        id="category_allowed",
        name="Product category is inside the mandate allow-list",
        status=CheckStatus.PASS,
        reason=f"Category '{ctx.product.category}' is on the mandate allow-list {allowed}.",
        observed={"product_category": ctx.product.category, "allowed_categories": allowed},
    )


def check_per_txn_cap(ctx: EvaluationContext) -> PolicyCheck:
    assert ctx.mandate is not None
    cap = ctx.mandate.per_txn_cap_paise
    if ctx.amount_paise > cap:
        return PolicyCheck(
            id="per_txn_cap",
            name="Amount is within the per-transaction cap",
            status=CheckStatus.FAIL,
            reason=(
                f"{_inr(ctx.amount_paise)} exceeds the per-transaction cap of {_inr(cap)} "
                f"by {_inr(ctx.amount_paise - cap)}. No single agent purchase may cross this line."
            ),
            observed={"amount_paise": ctx.amount_paise, "per_txn_cap_paise": cap},
        )
    return PolicyCheck(
        id="per_txn_cap",
        name="Amount is within the per-transaction cap",
        status=CheckStatus.PASS,
        reason=f"{_inr(ctx.amount_paise)} is within the per-transaction cap of {_inr(cap)}.",
        observed={"amount_paise": ctx.amount_paise, "per_txn_cap_paise": cap},
    )


def check_budget_remaining(ctx: EvaluationContext) -> PolicyCheck:
    assert ctx.mandate is not None
    mandate = ctx.mandate
    # Add back this intent's own hold so a re-evaluation after a human gate does
    # not double-count money the intent already reserved.
    available = (
        mandate.total_budget_paise
        - mandate.spent_paise
        - mandate.reserved_paise
        + ctx.self_reserved_paise
    )
    observed = {
        "amount_paise": ctx.amount_paise,
        "total_budget_paise": mandate.total_budget_paise,
        "spent_paise": mandate.spent_paise,
        "reserved_paise": mandate.reserved_paise,
        "available_paise": max(0, available),
    }
    if ctx.amount_paise > available:
        return PolicyCheck(
            id="budget_remaining",
            name="Mandate has enough budget left",
            status=CheckStatus.FAIL,
            reason=(
                f"{_inr(ctx.amount_paise)} would exceed the remaining budget of "
                f"{_inr(max(0, available))} (budget {_inr(mandate.total_budget_paise)} "
                f"minus {_inr(mandate.spent_paise)} already spent and "
                f"{_inr(mandate.reserved_paise)} held for in-flight purchases). "
                f"Short by {_inr(ctx.amount_paise - max(0, available))}."
            ),
            observed=observed,
        )
    return PolicyCheck(
        id="budget_remaining",
        name="Mandate has enough budget left",
        status=CheckStatus.PASS,
        reason=(
            f"{_inr(ctx.amount_paise)} fits inside the remaining budget of {_inr(available)}; "
            f"{_inr(available - ctx.amount_paise)} would remain afterwards."
        ),
        observed=observed,
    )


def _line_stock(ctx: EvaluationContext, product_id: str) -> int:
    product = ctx.offer_line_products.get(product_id)
    return product.stock if product is not None else 0


def check_stock_available(ctx: EvaluationContext) -> PolicyCheck:
    assert ctx.product is not None

    if ctx.offer is not None:
        short = [
            {
                "product_id": line.product_id,
                "title": line.title,
                "stock": _line_stock(ctx, line.product_id),
                "needed": line.qty,
            }
            for line in ctx.offer.lines
            if _line_stock(ctx, line.product_id) < line.qty
        ]
        if short:
            names = ", ".join(f"{s['title']} ({s['stock']} of {s['needed']})" for s in short)
            return PolicyCheck(
                id="stock_available",
                name="Merchant can actually fulfil the order",
                status=CheckStatus.FAIL,
                reason=(
                    f"Offer {ctx.offer.offer_id} cannot be fulfilled: {names}. Charging for "
                    "stock the merchant cannot ship is not allowed."
                ),
                observed={"short": short},
            )
        return PolicyCheck(
            id="stock_available",
            name="Merchant can actually fulfil the order",
            status=CheckStatus.PASS,
            reason=f"All {len(ctx.offer.lines)} line(s) of the offer are in stock.",
            observed={
                "lines": [
                    {
                        "product_id": line.product_id,
                        "qty": line.qty,
                        "stock": _line_stock(ctx, line.product_id),
                    }
                    for line in ctx.offer.lines
                ]
            },
        )

    if ctx.product.stock < ctx.qty:
        return PolicyCheck(
            id="stock_available",
            name="Merchant can actually fulfil the order",
            status=CheckStatus.FAIL,
            reason=(
                f"'{ctx.product.title}' has {ctx.product.stock} unit(s) in stock but the intent "
                f"asks for {ctx.qty}. Charging for stock the merchant cannot ship is not allowed."
            ),
            observed={"stock": ctx.product.stock, "qty": ctx.qty},
        )
    return PolicyCheck(
        id="stock_available",
        name="Merchant can actually fulfil the order",
        status=CheckStatus.PASS,
        reason=f"{ctx.product.stock} unit(s) in stock, {ctx.qty} requested.",
        observed={"stock": ctx.product.stock, "qty": ctx.qty},
    )


def check_high_value_gate(ctx: EvaluationContext) -> PolicyCheck:
    threshold = ctx.hitl_threshold_paise
    if ctx.amount_paise >= threshold:
        return PolicyCheck(
            id="high_value_gate",
            name="High-value purchases need a human",
            status=CheckStatus.GATE,
            reason=(
                f"{_inr(ctx.amount_paise)} is at or above the human-review threshold of "
                f"{_inr(threshold)}. Every other guardrail passed, so this is held for a "
                "person to approve or reject rather than denied."
            ),
            observed={"amount_paise": ctx.amount_paise, "hitl_threshold_paise": threshold},
        )
    return PolicyCheck(
        id="high_value_gate",
        name="High-value purchases need a human",
        status=CheckStatus.PASS,
        reason=(
            f"{_inr(ctx.amount_paise)} is below the human-review threshold of {_inr(threshold)}; "
            "the agent may proceed on its own authority."
        ),
        observed={"amount_paise": ctx.amount_paise, "hitl_threshold_paise": threshold},
    )


# Order matters: identity and authorisation before bounds, bounds before
# fulfilment, and the human gate last so it only fires on an otherwise-clean buy.
ORDERED_CHECKS: list[tuple[str, str, CheckFn]] = [
    ("mandate_valid", "Mandate is signed, unexpired and on record", check_mandate_valid),
    ("merchant_match", "Intent targets the merchant the mandate names", check_merchant_match),
    ("offer_honoured", "Any accepted offer still stands", check_offer_honoured),
    ("product_exists", "Product exists in the merchant catalog", check_product_exists),
    ("category_allowed", "Product category is inside the mandate allow-list", check_category_allowed),
    ("per_txn_cap", "Amount is within the per-transaction cap", check_per_txn_cap),
    ("budget_remaining", "Mandate has enough budget left", check_budget_remaining),
    ("stock_available", "Merchant can actually fulfil the order", check_stock_available),
    ("high_value_gate", "High-value purchases need a human", check_high_value_gate),
]


def evaluate(ctx: EvaluationContext) -> Decision:
    """Run every guardrail in order and return an explainable decision."""
    checks: list[PolicyCheck] = []
    failed_at: PolicyCheck | None = None
    gated_at: PolicyCheck | None = None

    for check_id, check_name, check_fn in ORDERED_CHECKS:
        if failed_at is not None:
            checks.append(
                PolicyCheck(
                    id=check_id,
                    name=check_name,
                    status=CheckStatus.SKIPPED,
                    reason=(
                        f"Not evaluated: '{failed_at.id}' already denied this intent, and no "
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
        return Decision(
            action=DecisionAction.DENY,
            reasons=[failed_at.reason],
            checks=checks,
            evaluated_at=iso(utcnow()),
            policy_version=POLICY_VERSION,
        )
    if gated_at is not None:
        return Decision(
            action=DecisionAction.GATE_FOR_HUMAN,
            reasons=[gated_at.reason],
            checks=checks,
            evaluated_at=iso(utcnow()),
            policy_version=POLICY_VERSION,
        )
    return Decision(
        action=DecisionAction.AUTO_APPROVE,
        reasons=[
            f"All {len(checks)} guardrails passed; amount is bounded by the mandate "
            "and below the human-review threshold."
        ],
        checks=checks,
        evaluated_at=iso(utcnow()),
        policy_version=POLICY_VERSION,
    )
