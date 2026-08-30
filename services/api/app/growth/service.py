"""Growth orchestration: propose, judge, publish, account, audit.

This is the seam where the three halves meet. `offers` proposes without seeing
cost, `engine` judges with cost in hand, `campaigns` does the money accounting,
and every outcome -- published, gated or suppressed -- lands on the same
hash-chained audit trail the buy side writes to.

The rule that makes the whole thing safe to run: an offer is only ever attached to
a purchase by `offer_id`, and the intent service re-fetches and re-verifies it
server-side. Nothing an agent sends can change what an offer costs.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from typing import Any

from ..audit import log as audit
from ..catalog import store as catalog
from ..config import get_settings
from ..db import connect, transaction
from ..models import (
    Campaign,
    CheckStatus,
    EvaluatedOffer,
    MandateRecord,
    OfferAction,
    OfferCheck,
    OfferDecision,
    OfferKind,
    OfferLine,
    OfferListResponse,
    OfferQuote,
    OfferStatus,
    Product,
    RebalanceMove,
    RebalanceResult,
    iso,
    utcnow,
)
from . import campaigns, economics
from .engine import OfferContext, evaluate
from .offers import OfferDraft, build_drafts

log = logging.getLogger("vyapaar.growth")


class GrowthError(Exception):
    """Anything a caller asked for that the growth layer will not do."""


def _inr(paise: int) -> str:
    return f"INR {paise / 100:,.2f}"


# --------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------


def _row_to_quote(row: sqlite3.Row) -> OfferQuote:
    return OfferQuote(
        offer_id=row["offer_id"],
        campaign_id=row["campaign_id"],
        kind=OfferKind(row["kind"]),
        anchor_product_id=row["anchor_product_id"],
        lines=[OfferLine(**line) for line in json.loads(row["lines_json"])],
        list_total_paise=row["list_total_paise"],
        offer_total_paise=row["offer_total_paise"],
        discount_paise=row["discount_paise"],
        discount_bps=row["discount_bps"],
        headline=row["headline"],
        rationale=row["rationale"],
        disclosure=row["disclosure"],
        expires_at=row["expires_at"],
        status=OfferStatus(row["status"]),
    )


def _row_to_evaluated(row: sqlite3.Row, *, include_margin: bool) -> EvaluatedOffer:
    quote = _row_to_quote(row)
    decision = OfferDecision(**json.loads(row["decision_json"]))
    margin = int(row["margin_paise"])
    return EvaluatedOffer(
        offer=quote,
        decision=decision,
        margin_paise=margin if include_margin else None,
        margin_bps=(
            int(round(margin * 10000 / quote.offer_total_paise))
            if include_margin and quote.offer_total_paise
            else None
        ),
    )


def get_offer(offer_id: str, *, include_margin: bool = False) -> EvaluatedOffer | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM offer WHERE offer_id = ?", (offer_id,)).fetchone()
    return None if row is None else _row_to_evaluated(row, include_margin=include_margin)


def list_offers(limit: int = 50, status: str | None = None) -> list[EvaluatedOffer]:
    """Merchant view: margins included."""
    sql = "SELECT * FROM offer"
    params: list[Any] = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_evaluated(r, include_margin=True) for r in rows]


def _persist(
    draft: OfferDraft,
    decision: OfferDecision,
    campaign: Campaign,
    margin_paise: int,
    status: OfferStatus,
    reserved_paise: int,
    buyer_id: str | None,
    conn: sqlite3.Connection,
) -> None:
    now = iso(utcnow())
    conn.execute(
        """
        INSERT INTO offer (offer_id, campaign_id, kind, anchor_product_id, lines_json,
                           list_total_paise, offer_total_paise, discount_paise, discount_bps,
                           baseline_paise, margin_paise, headline, rationale, disclosure, status,
                           decision_json, buyer_id, reserved_paise, expires_at,
                           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            draft.offer_id,
            campaign.campaign_id,
            draft.kind.value,
            draft.anchor_product_id,
            json.dumps([line.model_dump() for line in draft.lines]),
            draft.list_total_paise,
            draft.offer_total_paise,
            draft.discount_paise,
            draft.discount_bps,
            draft.baseline_paise,
            margin_paise,
            draft.headline,
            draft.rationale,
            draft.disclosure,
            status.value,
            decision.model_dump_json(),
            buyer_id,
            reserved_paise,
            draft.expires_at,
            now,
            now,
        ),
    )


def _set_status(offer_id: str, status: OfferStatus, conn: sqlite3.Connection, **extra: Any) -> None:
    sets = ["status = ?", "updated_at = ?"]
    params: list[Any] = [status.value, iso(utcnow())]
    for key, value in extra.items():
        sets.append(f"{key} = ?")
        params.append(value)
    params.append(offer_id)
    conn.execute(f"UPDATE offer SET {', '.join(sets)} WHERE offer_id = ?", params)


# --------------------------------------------------------------------------
# Quoting
# --------------------------------------------------------------------------


def _context_for(
    draft: OfferDraft,
    campaign: Campaign | None,
    products: dict[str, Product],
    mandate: MandateRecord | None,
) -> OfferContext:
    costs = economics.get_costs([line.product_id for line in draft.lines])
    cost_total = sum(costs.get(line.product_id, 0) * line.qty for line in draft.lines)
    return OfferContext(
        kind=draft.kind,
        anchor_product_id=draft.anchor_product_id,
        anchor_category=draft.anchor_category,
        lines=draft.lines,
        list_total_paise=draft.list_total_paise,
        offer_total_paise=draft.offer_total_paise,
        discount_paise=draft.discount_paise,
        discount_bps=draft.discount_bps,
        cost_total_paise=cost_total,
        campaign=campaign,
        campaign_invalid_reason=(
            None if campaign is not None else "No campaign is active for this merchant."
        ),
        catalog_prices={p.id: p.price_paise for p in products.values()},
        stock_levels={p.id: p.stock for p in products.values()},
        mandate=mandate,
    )


def quote_offers(
    anchor_product_id: str, mandate: MandateRecord | None = None
) -> OfferListResponse:
    """Build every candidate offer for an anchor, judge it, persist the outcome.

    Suppressed offers are returned alongside published ones rather than hidden. An
    agent that asked deserves to know an offer existed and why it is not being
    made -- that is the same courtesy the buy-side gauntlet extends when it denies
    a purchase.
    """
    settings = get_settings()
    anchor = catalog.get_product(anchor_product_id)
    if anchor is None:
        raise GrowthError(f"No product with id {anchor_product_id}")

    if anchor.stock < 1:
        # The offer surface exists for a product an agent is about to buy. Upselling
        # from something the merchant cannot ship would leave the buyer holding an
        # offer whose anchor is unavailable, which is a worse experience than an
        # honest empty shelf.
        return OfferListResponse(
            merchant_id=settings.merchant_id,
            anchor_product_id=anchor.id,
            generated_at=iso(utcnow()),
            mandate_aware=mandate is not None,
            offers=[],
            withheld=[
                {
                    "offer_id": None,
                    "kind": "all",
                    "headline": f"No offers on {anchor.title}",
                    "failed_check": "stock_cover",
                    "reason": (
                        f"'{anchor.title}' is out of stock, so there is nothing to anchor an "
                        "offer to."
                    ),
                }
            ],
        )

    campaign = campaigns.active_campaign()
    all_products, _ = catalog.list_products(limit=500, offset=0)
    by_id = {p.id: p for p in all_products}
    by_id[anchor.id] = anchor

    max_bps = campaign.max_discount_bps if campaign else 0
    drafts = build_drafts(anchor, all_products, max_bps) if campaign else []

    published: list[OfferQuote] = []
    withheld: list[dict[str, Any]] = []

    for draft in drafts:
        ctx = _context_for(draft, campaign, by_id, mandate)
        decision = evaluate(ctx)

        if decision.action == OfferAction.SUPPRESS:
            with transaction() as conn:
                _persist(
                    draft, decision, campaign, ctx.margin_paise,
                    OfferStatus.SUPPRESSED, 0, mandate.buyer_id if mandate else None, conn,
                )
                failed = next(
                    (c for c in decision.checks if c.status == CheckStatus.FAIL), None
                )
                audit.record(
                    actor="growth-agent",
                    event_type="offer.suppressed",
                    summary=(
                        f"Offer withheld on {anchor.title}: {failed.id if failed else 'guardrail'} "
                        f"refused {_inr(draft.discount_paise)} of discount"
                    ),
                    decision=decision.action.value,
                    reasons=decision.reasons,
                    amount_paise=draft.discount_paise,
                    mandate_id=mandate.mandate_id if mandate else None,
                    payload={
                        "offer_id": draft.offer_id,
                        "kind": draft.kind.value,
                        "anchor_product_id": anchor.id,
                        "failed_check": failed.id if failed else None,
                        "checks": [c.model_dump() for c in decision.checks],
                    },
                    conn=conn,
                )
            withheld.append(
                {
                    "offer_id": draft.offer_id,
                    "kind": draft.kind.value,
                    "headline": draft.headline,
                    "failed_check": next(
                        (c.id for c in decision.checks if c.status == CheckStatus.FAIL), None
                    ),
                    "reason": decision.reasons[0] if decision.reasons else "",
                }
            )
            continue

        # Published or gated: either way the discount is held against the campaign,
        # so a gated offer cannot be over-committed while a human thinks about it.
        status = (
            OfferStatus.GATED
            if decision.action == OfferAction.GATE_FOR_HUMAN
            else OfferStatus.PUBLISHED
        )
        with transaction() as conn:
            if not campaigns.reserve(campaign.campaign_id, draft.discount_paise, conn):
                # The ledger refused what the gauntlet allowed: another offer took the
                # budget between evaluation and commit. Record it as suppressed.
                lost = OfferCheck(
                    id="campaign_budget",
                    name="Campaign has discount budget left",
                    status=CheckStatus.FAIL,
                    reason=(
                        f"Another offer claimed the remaining discount budget before this one "
                        f"committed. {_inr(draft.discount_paise)} is no longer available."
                    ),
                    observed={"discount_paise": draft.discount_paise},
                )
                raced = OfferDecision(
                    action=OfferAction.SUPPRESS,
                    reasons=[lost.reason],
                    checks=[*decision.checks[:-1], lost],
                    evaluated_at=iso(utcnow()),
                )
                _persist(
                    draft, raced, campaign, ctx.margin_paise,
                    OfferStatus.SUPPRESSED, 0, mandate.buyer_id if mandate else None, conn,
                )
                withheld.append(
                    {
                        "offer_id": draft.offer_id,
                        "kind": draft.kind.value,
                        "headline": draft.headline,
                        "failed_check": "campaign_budget",
                        "reason": lost.reason,
                    }
                )
                continue

            _persist(
                draft, decision, campaign, ctx.margin_paise, status,
                draft.discount_paise, mandate.buyer_id if mandate else None, conn,
            )
            audit.record(
                actor="growth-agent",
                event_type="offer.gated" if status is OfferStatus.GATED else "offer.published",
                summary=(
                    f"{'Gated' if status is OfferStatus.GATED else 'Published'} "
                    f"{draft.kind.value} offer on {anchor.title}: {_inr(draft.discount_paise)} off "
                    f"({draft.discount_bps / 100:.2f}%), margin held at "
                    f"{ctx.margin_bps / 100:.2f}%"
                ),
                decision=decision.action.value,
                reasons=decision.reasons,
                amount_paise=draft.discount_paise,
                mandate_id=mandate.mandate_id if mandate else None,
                payload={
                    "offer_id": draft.offer_id,
                    "kind": draft.kind.value,
                    "anchor_product_id": anchor.id,
                    "offer_total_paise": draft.offer_total_paise,
                    "list_total_paise": draft.list_total_paise,
                    "discount_bps": draft.discount_bps,
                    "checks": [c.model_dump() for c in decision.checks],
                },
                conn=conn,
            )

        if status is OfferStatus.PUBLISHED:
            published.append(
                OfferQuote(
                    offer_id=draft.offer_id,
                    campaign_id=campaign.campaign_id,
                    kind=draft.kind,
                    anchor_product_id=draft.anchor_product_id,
                    lines=draft.lines,
                    list_total_paise=draft.list_total_paise,
                    offer_total_paise=draft.offer_total_paise,
                    discount_paise=draft.discount_paise,
                    discount_bps=draft.discount_bps,
                    headline=draft.headline,
                    rationale=draft.rationale,
                    disclosure=draft.disclosure,
                    expires_at=draft.expires_at,
                    status=OfferStatus.PUBLISHED,
                )
            )
        else:
            withheld.append(
                {
                    "offer_id": draft.offer_id,
                    "kind": draft.kind.value,
                    "headline": draft.headline,
                    "failed_check": "deep_discount_gate",
                    "reason": decision.reasons[0] if decision.reasons else "",
                }
            )

    return OfferListResponse(
        merchant_id=settings.merchant_id,
        anchor_product_id=anchor.id,
        generated_at=iso(utcnow()),
        mandate_aware=mandate is not None,
        offers=published,
        withheld=withheld,
    )


# --------------------------------------------------------------------------
# Lifecycle
# --------------------------------------------------------------------------


def verify_for_intent(offer_id: str) -> tuple[OfferQuote, OfferDecision, str]:
    """Re-verify a published offer at the moment a buyer tries to use it.

    Called by the intent service, not by an agent. Returns the offer, its stored
    decision, and a reason string that is empty when the offer is usable. The
    buy-side `offer_honoured` check turns a non-empty reason into a denial.
    """
    evaluated = get_offer(offer_id, include_margin=True)
    if evaluated is None:
        return (
            None,  # type: ignore[return-value]
            None,  # type: ignore[return-value]
            f"No offer with id {offer_id} was ever published by this merchant.",
        )

    offer = evaluated.offer
    if offer.status not in (OfferStatus.PUBLISHED, OfferStatus.GATED):
        return offer, evaluated.decision, (
            f"Offer {offer_id} is {offer.status.value}, not available to accept."
        )
    if offer.status is OfferStatus.GATED:
        return offer, evaluated.decision, (
            f"Offer {offer_id} is a deep discount still waiting on merchant approval."
        )
    if offer.expires_at <= iso(utcnow()):
        return offer, evaluated.decision, (
            f"Offer {offer_id} expired at {offer.expires_at}."
        )

    # Prices can move between publication and acceptance. The buyer pays what the
    # offer said, so the offer has to still reconcile against the live catalog.
    for line in offer.lines:
        product = catalog.get_product(line.product_id)
        if product is None:
            return offer, evaluated.decision, (
                f"Offer {offer_id} includes {line.product_id}, which is no longer listed."
            )
        if product.price_paise != line.unit_price_paise:
            return offer, evaluated.decision, (
                f"{product.title} was {_inr(line.unit_price_paise)} when the offer was made and "
                f"is {_inr(product.price_paise)} now. The offer is not honoured at the old price."
            )
        if product.stock < line.qty:
            return offer, evaluated.decision, (
                f"{product.title} has {product.stock} in stock but the offer needs {line.qty}."
            )

    return offer, evaluated.decision, ""


def mark_accepted(offer_id: str, intent_id: str, buyer_id: str, conn: sqlite3.Connection) -> None:
    _set_status(offer_id, OfferStatus.ACCEPTED, conn, intent_id=intent_id, buyer_id=buyer_id)


def decline(offer_id: str, reason: str = "Buyer agent declined the offer.") -> EvaluatedOffer | None:
    """A buyer looked and passed. Release the discount hold so it can fund another offer."""
    evaluated = get_offer(offer_id, include_margin=True)
    if evaluated is None:
        raise GrowthError(f"No offer with id {offer_id}")
    if evaluated.offer.status not in (OfferStatus.PUBLISHED, OfferStatus.GATED):
        return evaluated

    with transaction() as conn:
        row = conn.execute(
            "SELECT reserved_paise, campaign_id FROM offer WHERE offer_id = ?", (offer_id,)
        ).fetchone()
        held = int(row["reserved_paise"]) if row else 0
        campaigns.release(row["campaign_id"], held, conn)
        _set_status(offer_id, OfferStatus.DECLINED, conn, reserved_paise=0)
        audit.record(
            actor="buyer-agent",
            event_type="offer.declined",
            summary=f"Offer {offer_id} declined; {_inr(held)} of discount budget returned",
            reasons=[reason],
            amount_paise=held,
            payload={"offer_id": offer_id, "released_paise": held},
            conn=conn,
        )
    return get_offer(offer_id, include_margin=True)


def resolve_gate(offer_id: str, approve: bool, resolved_by: str = "merchant-operator") -> EvaluatedOffer:
    """A human decides on a deep discount.

    Approving does not waive the other guardrails -- the offer is re-evaluated
    against current state first. A person may waive the depth of the discount, not
    the margin floor, the stock cover or the campaign budget.
    """
    evaluated = get_offer(offer_id, include_margin=True)
    if evaluated is None:
        raise GrowthError(f"No offer with id {offer_id}")
    if evaluated.offer.status is not OfferStatus.GATED:
        raise GrowthError(f"Offer {offer_id} is {evaluated.offer.status.value}, not GATED.")

    offer = evaluated.offer

    if not approve:
        with transaction() as conn:
            row = conn.execute(
                "SELECT reserved_paise FROM offer WHERE offer_id = ?", (offer_id,)
            ).fetchone()
            held = int(row["reserved_paise"]) if row else 0
            campaigns.release(offer.campaign_id, held, conn)
            _set_status(offer_id, OfferStatus.SUPPRESSED, conn, reserved_paise=0)
            audit.record(
                actor=resolved_by,
                event_type="offer.gate_rejected",
                summary=f"Merchant rejected the {_inr(offer.discount_paise)} discount on offer {offer_id}",
                decision=OfferAction.SUPPRESS.value,
                reasons=[f"{resolved_by} declined to approve this depth of discount."],
                amount_paise=offer.discount_paise,
                payload={"offer_id": offer_id},
                conn=conn,
            )
        return get_offer(offer_id, include_margin=True)  # type: ignore[return-value]

    # Re-run the gauntlet against live state, with the gate waived by the human.
    campaign = campaigns.get(offer.campaign_id)
    all_products, _ = catalog.list_products(limit=500, offset=0)
    by_id = {p.id: p for p in all_products}
    costs = economics.get_costs([line.product_id for line in offer.lines])
    ctx = OfferContext(
        kind=offer.kind,
        anchor_product_id=offer.anchor_product_id,
        anchor_category=by_id[offer.anchor_product_id].category
        if offer.anchor_product_id in by_id
        else "",
        lines=offer.lines,
        list_total_paise=offer.list_total_paise,
        offer_total_paise=offer.offer_total_paise,
        discount_paise=offer.discount_paise,
        discount_bps=offer.discount_bps,
        cost_total_paise=sum(costs.get(line.product_id, 0) * line.qty for line in offer.lines),
        campaign=campaign,
        catalog_prices={p.id: p.price_paise for p in by_id.values()},
        stock_levels={p.id: p.stock for p in by_id.values()},
        mandate=None,
    )
    recheck = evaluate(ctx)

    if recheck.action == OfferAction.SUPPRESS:
        with transaction() as conn:
            row = conn.execute(
                "SELECT reserved_paise FROM offer WHERE offer_id = ?", (offer_id,)
            ).fetchone()
            held = int(row["reserved_paise"]) if row else 0
            campaigns.release(offer.campaign_id, held, conn)
            _set_status(
                offer_id, OfferStatus.SUPPRESSED, conn,
                reserved_paise=0, decision_json=recheck.model_dump_json(),
            )
            audit.record(
                actor=resolved_by,
                event_type="offer.gate_failed_recheck",
                summary=(
                    f"Offer {offer_id} was approved by a human but failed re-evaluation "
                    "against current state"
                ),
                decision=recheck.action.value,
                reasons=recheck.reasons,
                amount_paise=offer.discount_paise,
                payload={"offer_id": offer_id, "checks": [c.model_dump() for c in recheck.checks]},
                conn=conn,
            )
        return get_offer(offer_id, include_margin=True)  # type: ignore[return-value]

    with transaction() as conn:
        _set_status(
            offer_id, OfferStatus.PUBLISHED, conn, decision_json=recheck.model_dump_json()
        )
        audit.record(
            actor=resolved_by,
            event_type="offer.gate_approved",
            summary=(
                f"Merchant approved {_inr(offer.discount_paise)} off on offer {offer_id}; "
                "every other guardrail re-checked and still passing"
            ),
            decision=OfferAction.AUTO_PUBLISH.value,
            reasons=[f"{resolved_by} approved the discount depth.", *recheck.reasons],
            amount_paise=offer.discount_paise,
            payload={"offer_id": offer_id, "checks": [c.model_dump() for c in recheck.checks]},
            conn=conn,
        )
    return get_offer(offer_id, include_margin=True)  # type: ignore[return-value]


def settle_for_intent(intent_id: str, conn: sqlite3.Connection) -> int:
    """Payment settled: turn the offer's discount hold into given-away spend."""
    row = conn.execute(
        "SELECT offer_id, campaign_id, reserved_paise FROM offer WHERE intent_id = ?",
        (intent_id,),
    ).fetchone()
    if row is None:
        return 0
    held = int(row["reserved_paise"])
    campaigns.settle(row["campaign_id"], held, conn)
    conn.execute(
        "UPDATE offer SET reserved_paise = 0, updated_at = ? WHERE offer_id = ?",
        (iso(utcnow()), row["offer_id"]),
    )
    return held


def release_for_intent(intent_id: str, conn: sqlite3.Connection) -> int:
    """Payment failed or the intent died: return the discount to the campaign."""
    row = conn.execute(
        "SELECT offer_id, campaign_id, reserved_paise FROM offer WHERE intent_id = ?",
        (intent_id,),
    ).fetchone()
    if row is None:
        return 0
    held = int(row["reserved_paise"])
    campaigns.release(row["campaign_id"], held, conn)
    conn.execute(
        "UPDATE offer SET reserved_paise = 0, status = ?, updated_at = ? WHERE offer_id = ?",
        (OfferStatus.EXPIRED.value, iso(utcnow()), row["offer_id"]),
    )
    return held


# --------------------------------------------------------------------------
# Campaign orchestrator
# --------------------------------------------------------------------------

# Inventory thresholds the orchestrator reasons over. Deliberately blunt and
# readable: a judge should be able to predict every move it makes.
OVERSTOCK_UNITS = 30
THIN_STOCK_UNITS = 5


def rebalance(campaign_id: str | None = None) -> RebalanceResult:
    """Re-point the campaign at the inventory that needs the help.

    Deterministic and explainable, in the same spirit as the guardrail engine. Each
    move names the product, the action, and the observation that drove it, and the
    whole pass lands on the audit chain as one event.

    The orchestrator never touches price or margin directly -- it only decides
    *where* the campaign pushes. Anything it promotes still has to clear the same
    gauntlet when the offer is actually built.
    """
    campaign = campaigns.get(campaign_id) if campaign_id else campaigns.active_campaign()
    if campaign is None:
        raise GrowthError("No active campaign to rebalance.")

    products, _ = catalog.list_products(limit=500, offset=0)
    in_scope = [
        p
        for p in products
        if not campaign.allowed_categories or p.category in campaign.allowed_categories
    ]
    costs = economics.get_costs([p.id for p in in_scope])

    moves: list[RebalanceMove] = []
    for product in in_scope:
        cost = costs.get(product.id)
        margin_bps = (
            int(round((product.price_paise - cost) * 10000 / product.price_paise))
            if cost is not None and product.price_paise
            else 0
        )

        if product.stock == 0:
            continue

        if margin_bps < campaign.floor_margin_bps:
            moves.append(
                RebalanceMove(
                    product_id=product.id,
                    title=product.title,
                    action="withdraw",
                    reason=(
                        f"Earns {margin_bps / 100:.2f}% at list, already under the campaign's "
                        f"{campaign.floor_margin_bps / 100:.2f}% floor. Any discount here sells "
                        "below the line the merchant set."
                    ),
                    observed={"margin_bps": margin_bps, "floor_margin_bps": campaign.floor_margin_bps},
                )
            )
        elif product.stock <= THIN_STOCK_UNITS:
            moves.append(
                RebalanceMove(
                    product_id=product.id,
                    title=product.title,
                    action="withdraw",
                    reason=(
                        f"Only {product.stock} left. Promoting the last units risks selling "
                        "stock the merchant cannot ship."
                    ),
                    observed={"stock": product.stock, "thin_stock_units": THIN_STOCK_UNITS},
                )
            )
        elif product.stock >= OVERSTOCK_UNITS:
            moves.append(
                RebalanceMove(
                    product_id=product.id,
                    title=product.title,
                    action="promote",
                    reason=(
                        f"{product.stock} units on hand against a {OVERSTOCK_UNITS}-unit overstock "
                        f"line, and {margin_bps / 100:.2f}% margin leaves room to discount. "
                        "Worth pushing."
                    ),
                    observed={"stock": product.stock, "margin_bps": margin_bps},
                )
            )

    promoted = [m for m in moves if m.action == "promote"]
    withdrawn = [m for m in moves if m.action == "withdraw"]
    summary = (
        f"Reviewed {len(in_scope)} in-scope products: promoting {len(promoted)} overstocked "
        f"line(s), withdrawing {len(withdrawn)} that are thin on stock or margin."
    )

    with transaction() as conn:
        conn.execute(
            "UPDATE campaign SET suppressed_json = ?, updated_at = ? WHERE campaign_id = ?",
            (
                json.dumps([m.product_id for m in withdrawn]),
                iso(utcnow()),
                campaign.campaign_id,
            ),
        )
        audit.record(
            actor="growth-agent",
            event_type="campaign.rebalanced",
            summary=summary,
            reasons=[m.reason for m in moves[:6]],
            payload={
                "campaign_id": campaign.campaign_id,
                "evaluated": len(in_scope),
                "moves": [m.model_dump() for m in moves],
            },
            conn=conn,
        )

    return RebalanceResult(
        campaign_id=campaign.campaign_id,
        evaluated=len(in_scope),
        moves=moves,
        summary=summary,
    )
