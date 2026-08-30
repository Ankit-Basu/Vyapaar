"""Offer construction: what the growth agent *wants* to offer.

A deliberate asymmetry runs through this file. The builder can see the catalog,
stock levels and purchase affinity -- but it cannot see cost price. `economics` is
never imported here. The builder proposes the most persuasive offer it can within
the campaign's published discount ceiling, and the margin gauntlet, which *does*
see cost, decides whether the merchant can afford it.

That is the same shape as the buy side: the buyer agent proposes, the policy engine
disposes. An offer builder that could see the margin floor would quietly clamp to
it and the floor would never visibly fire. Keeping cost out of this module makes
`margin_floor` a real check rather than a formality.

Three offer shapes, chosen because they are the three that actually move retail
revenue and are all expressible as arithmetic an agent can verify:

* `bundle`  -- attach a complement, price it below the sum of the parts (AOV up)
* `volume`  -- unit price falls at a quantity threshold (units per order up)
* `upgrade` -- a better item in the same category, the delta narrowed (mix up)
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import timedelta

from ..models import OfferKind, OfferLine, Product, iso, utcnow

OFFER_TTL_MINUTES = 15

# Categories that genuinely co-purchase. A desk setup spans electronics and office;
# kitchen and fitness goods attach within themselves. Deliberately conservative --
# a bundle nobody wants is worse than no bundle.
CATEGORY_AFFINITY: dict[str, tuple[str, ...]] = {
    "electronics": ("electronics", "office"),
    "office": ("office", "electronics"),
    "home_kitchen": ("home_kitchen",),
    "fitness": ("fitness",),
}

# A complement should read as "add this", not "buy a second main thing". Below the
# floor it is too trivial to move AOV; above the ceiling it is a competing purchase.
COMPLEMENT_MIN_RATIO = 0.15
COMPLEMENT_MAX_RATIO = 0.75

# What the growth agent reaches for before the gauntlet trims it back.
TARGET_BUNDLE_BPS = 900       # 9% off a two-item bundle
TARGET_VOLUME_BPS = 1200      # 12% off at the volume tier
TARGET_UPGRADE_BPS = 700      # 7% off the step up
VOLUME_TIER_QTY = 3

# An upgrade has to be a real step up, not a rounding error, and not a different
# budget entirely.
UPGRADE_MIN_RATIO = 1.25
UPGRADE_MAX_RATIO = 3.0


def _offer_id() -> str:
    return f"ofr_{secrets.token_hex(10)}"


def _brand(title: str) -> str:
    """Products in this catalog lead with their line name: 'Aurora', 'Meridian'."""
    return title.split(" ", 1)[0].lower()


def _line(product: Product, qty: int, *, is_anchor: bool = False) -> OfferLine:
    return OfferLine(
        product_id=product.id,
        title=product.title,
        category=product.category,
        qty=qty,
        unit_price_paise=product.price_paise,
        line_total_paise=product.price_paise * qty,
        is_anchor=is_anchor,
    )


@dataclass(frozen=True)
class OfferDraft:
    """A proposed offer, before the margin gauntlet has judged it."""

    offer_id: str
    kind: OfferKind
    anchor_product_id: str
    anchor_category: str
    lines: list[OfferLine]
    list_total_paise: int
    offer_total_paise: int
    discount_paise: int
    discount_bps: int
    # What this buyer would have paid had no offer been made: one anchor at list.
    # Attribution measures the growth agent against exactly this counterfactual.
    baseline_paise: int
    headline: str
    rationale: str
    disclosure: str
    expires_at: str


def _price(list_total: int, target_bps: int, max_bps: int) -> tuple[int, int, int]:
    """Apply the target discount, clamped to the campaign's published ceiling.

    Returns `(offer_total, discount, actual_bps)`. The actual bps is recomputed from
    the rounded integer discount rather than assumed, so `offer_integrity` can prove
    the stated saving against the real one.
    """
    bps = min(target_bps, max_bps)
    discount = int(round(list_total * bps / 10000))
    offer_total = list_total - discount
    actual_bps = int(round(discount * 10000 / list_total)) if list_total else 0
    return offer_total, discount, actual_bps


def _affinity_score(anchor: Product, candidate: Product) -> float:
    """How well `candidate` attaches to `anchor`. Higher is better, 0 disqualifies.

    Signals, in order of weight: same product line, category adjacency, a price
    ratio in the attach band, and stock depth as a tie-break so the agent leans on
    inventory the merchant is actually long on.
    """
    if candidate.id == anchor.id or candidate.stock < 1:
        return 0.0
    if candidate.category not in CATEGORY_AFFINITY.get(anchor.category, ()):
        return 0.0

    ratio = candidate.price_paise / anchor.price_paise if anchor.price_paise else 0.0
    if not (COMPLEMENT_MIN_RATIO <= ratio <= COMPLEMENT_MAX_RATIO):
        return 0.0

    score = 1.0
    if _brand(candidate.title) == _brand(anchor.title):
        score += 1.5
    if candidate.category == anchor.category:
        score += 0.5
    # Peak attach appeal sits around a third of the anchor's price.
    score += 1.0 - min(1.0, abs(ratio - 0.35) / 0.4)
    score += min(0.5, candidate.stock / 100.0)
    return score


def best_complement(anchor: Product, catalog: list[Product]) -> Product | None:
    ranked = sorted(
        ((c, _affinity_score(anchor, c)) for c in catalog),
        key=lambda pair: (-pair[1], pair[0].id),
    )
    for candidate, score in ranked:
        if score > 0:
            return candidate
    return None


def best_upgrade(anchor: Product, catalog: list[Product]) -> Product | None:
    candidates = [
        c
        for c in catalog
        if c.id != anchor.id
        and c.category == anchor.category
        and c.stock > 0
        and anchor.price_paise > 0
        and UPGRADE_MIN_RATIO <= c.price_paise / anchor.price_paise <= UPGRADE_MAX_RATIO
    ]
    if not candidates:
        return None
    # The nearest genuine step up converts better than the most expensive one.
    return min(candidates, key=lambda c: (c.price_paise, c.id))


def build_bundle(anchor: Product, catalog: list[Product], max_discount_bps: int) -> OfferDraft | None:
    complement = best_complement(anchor, catalog)
    if complement is None:
        return None

    lines = [_line(anchor, 1, is_anchor=True), _line(complement, 1)]
    list_total = sum(line.line_total_paise for line in lines)
    offer_total, discount, bps = _price(list_total, TARGET_BUNDLE_BPS, max_discount_bps)
    if discount <= 0:
        return None

    return OfferDraft(
        offer_id=_offer_id(),
        kind=OfferKind.BUNDLE,
        anchor_product_id=anchor.id,
        anchor_category=anchor.category,
        lines=lines,
        list_total_paise=list_total,
        offer_total_paise=offer_total,
        discount_paise=discount,
        discount_bps=bps,
        baseline_paise=anchor.price_paise,
        headline=f"Add the {complement.title} and save {discount / 100:,.0f}",
        rationale=(
            f"{complement.title} is bought alongside {anchor.title}: same "
            f"{'product line' if _brand(complement.title) == _brand(anchor.title) else 'use context'}, "
            f"priced at {complement.price_paise / anchor.price_paise:.0%} of the anchor, "
            f"{complement.stock} in stock. Attaching it raises order value without a second "
            "checkout."
        ),
        disclosure=(
            f"Accepting adds 1 x {complement.title} to the order. You pay "
            f"INR {offer_total / 100:,.2f} instead of INR {list_total / 100:,.2f} for both items "
            f"bought separately. Declining leaves the original purchase of {anchor.title} at "
            f"INR {anchor.price_paise / 100:,.2f} completely unchanged."
        ),
        expires_at=iso(utcnow() + timedelta(minutes=OFFER_TTL_MINUTES)),
    )


def build_volume(anchor: Product, max_discount_bps: int, qty: int = VOLUME_TIER_QTY) -> OfferDraft | None:
    if anchor.stock < qty:
        return None

    lines = [_line(anchor, qty, is_anchor=True)]
    list_total = lines[0].line_total_paise
    offer_total, discount, bps = _price(list_total, TARGET_VOLUME_BPS, max_discount_bps)
    if discount <= 0:
        return None

    unit_after = offer_total // qty
    return OfferDraft(
        offer_id=_offer_id(),
        kind=OfferKind.VOLUME,
        anchor_product_id=anchor.id,
        anchor_category=anchor.category,
        lines=lines,
        list_total_paise=list_total,
        offer_total_paise=offer_total,
        discount_paise=discount,
        discount_bps=bps,
        baseline_paise=anchor.price_paise,
        headline=f"Take {qty} and pay {unit_after / 100:,.0f} each",
        rationale=(
            f"{anchor.stock} units of {anchor.title} are on hand. Moving {qty} in one order "
            "cuts per-unit fulfilment cost and clears inventory faster than three separate "
            "sales would."
        ),
        disclosure=(
            f"Accepting buys {qty} x {anchor.title} for INR {offer_total / 100:,.2f} "
            f"(INR {unit_after / 100:,.2f} each) instead of "
            f"INR {list_total / 100:,.2f}. You are committing to {qty} units, not 1."
        ),
        expires_at=iso(utcnow() + timedelta(minutes=OFFER_TTL_MINUTES)),
    )


def build_upgrade(anchor: Product, catalog: list[Product], max_discount_bps: int) -> OfferDraft | None:
    upgrade = best_upgrade(anchor, catalog)
    if upgrade is None:
        return None

    lines = [_line(upgrade, 1, is_anchor=True)]
    list_total = lines[0].line_total_paise
    offer_total, discount, bps = _price(list_total, TARGET_UPGRADE_BPS, max_discount_bps)
    if discount <= 0:
        return None

    step_up = offer_total - anchor.price_paise
    if step_up <= 0:
        # After the discount the upgrade is not dearer than the anchor, which makes
        # this a price cut rather than an upgrade. Not the offer we meant to make.
        return None

    return OfferDraft(
        offer_id=_offer_id(),
        kind=OfferKind.UPGRADE,
        anchor_product_id=anchor.id,
        anchor_category=anchor.category,
        lines=lines,
        list_total_paise=list_total,
        offer_total_paise=offer_total,
        discount_paise=discount,
        discount_bps=bps,
        baseline_paise=anchor.price_paise,
        headline=f"Step up to the {upgrade.title} for {step_up / 100:,.0f} more",
        rationale=(
            f"{upgrade.title} sits one tier above {anchor.title} in the same category at "
            f"{upgrade.price_paise / anchor.price_paise:.1f}x list. Discounting the step "
            f"narrows the gap to INR {step_up / 100:,.2f} and lifts the order's mix."
        ),
        disclosure=(
            f"This replaces {anchor.title} with {upgrade.title}. You pay "
            f"INR {offer_total / 100:,.2f} rather than INR {list_total / 100:,.2f} list, which "
            f"is INR {step_up / 100:,.2f} more than the "
            f"INR {anchor.price_paise / 100:,.2f} you were about to spend. "
            "It is a different product, not a discount on the one you chose."
        ),
        expires_at=iso(utcnow() + timedelta(minutes=OFFER_TTL_MINUTES)),
    )


def build_drafts(anchor: Product, catalog: list[Product], max_discount_bps: int) -> list[OfferDraft]:
    """Every offer worth proposing for this anchor, best-attaching first."""
    drafts = [
        build_bundle(anchor, catalog, max_discount_bps),
        build_volume(anchor, max_discount_bps),
        build_upgrade(anchor, catalog, max_discount_bps),
    ]
    return [d for d in drafts if d is not None]
