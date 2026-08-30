"""Typed contracts shared across catalog, mandate, policy, payments and audit.

These are mirrored one-for-one as zod schemas in `packages/shared-types` so the
Next.js dashboard and the API cannot drift apart.

Money is *always* an integer count of paise (100 paise = INR 1). Never a float.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class Base(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# --------------------------------------------------------------------------
# Catalog
# --------------------------------------------------------------------------


class Product(Base):
    """One purchasable item, in the shape an agent needs to make a decision.

    Every field a buyer agent must reason over is explicit and typed. There are no
    prose-only fields: `attributes` carries structured specs, not a paragraph.
    """

    id: str
    title: str
    description: str
    category: str
    price_paise: int = Field(ge=0, description="Integer minor units (paise). 129900 = INR 1,299.00")
    currency: Literal["INR"] = "INR"
    stock: int = Field(ge=0)
    attributes: dict[str, Any] = Field(default_factory=dict)

    @property
    def in_stock(self) -> bool:
        return self.stock > 0


class ScoredProduct(Base):
    """A search hit: the product plus why the retriever surfaced it."""

    product: Product
    score: float = Field(description="Hybrid relevance score in [0,1]; higher is better.")
    lexical_score: float
    semantic_score: float
    rationale: str = Field(description="Machine-readable reason this product matched the query.")


class CatalogFeedPage(Base):
    """ACP-style machine-readable product feed."""

    schema_version: Literal["vyapaar.catalog.v1"] = "vyapaar.catalog.v1"
    merchant_id: str
    merchant_name: str
    currency: Literal["INR"] = "INR"
    generated_at: str
    total: int
    limit: int
    offset: int
    next_offset: int | None = None
    categories: list[str]
    products: list[Product]


class CatalogSearchResponse(Base):
    query: str
    filters: dict[str, Any]
    total_matched: int
    results: list[ScoredProduct]


# --------------------------------------------------------------------------
# Mandate (AP2-style signed consent + UAP-style spend caps)
# --------------------------------------------------------------------------


class MandateIssueRequest(Base):
    buyer_id: str = Field(min_length=1, max_length=128)
    merchant_id: str = Field(min_length=1, max_length=128)
    per_txn_cap_paise: int = Field(gt=0)
    total_budget_paise: int = Field(gt=0)
    allowed_categories: list[str] = Field(min_length=1)
    expires_at: datetime | None = Field(
        default=None, description="Absolute expiry. Defaults to 24h from issue when omitted."
    )
    ttl_hours: int | None = Field(default=None, gt=0, description="Alternative to expires_at.")
    label: str | None = Field(default=None, max_length=200)

    @field_validator("allowed_categories")
    @classmethod
    def _normalise_categories(cls, v: list[str]) -> list[str]:
        seen: list[str] = []
        for item in v:
            slug = item.strip().lower()
            if slug and slug not in seen:
                seen.append(slug)
        if not seen:
            raise ValueError("allowed_categories must contain at least one non-empty category")
        return seen


class MandateClaims(Base):
    """The signed payload. This is what a verifier gets back from a mandate token."""

    mandate_id: str
    buyer_id: str
    merchant_id: str
    per_txn_cap_paise: int
    total_budget_paise: int
    allowed_categories: list[str]
    issued_at: str
    expires_at: str
    issuer: str


class MandateRecord(Base):
    """Server-side state. `spent` and `reserved` live here, never in the token."""

    mandate_id: str
    buyer_id: str
    merchant_id: str
    per_txn_cap_paise: int
    total_budget_paise: int
    spent_paise: int
    reserved_paise: int
    allowed_categories: list[str]
    issued_at: str
    expires_at: str
    revoked_at: str | None = None
    label: str | None = None

    @property
    def available_paise(self) -> int:
        """Budget an agent may still commit: total minus settled spend minus in-flight holds."""
        return max(0, self.total_budget_paise - self.spent_paise - self.reserved_paise)

    @property
    def is_expired(self) -> bool:
        return datetime.fromisoformat(self.expires_at.replace("Z", "+00:00")) <= utcnow()


class MandateIssueResponse(Base):
    mandate_token: str = Field(description="Signed JWT. Present this on every purchase intent.")
    mandate: MandateRecord
    claims: MandateClaims


class MandateVerifyRequest(Base):
    mandate_token: str


class MandateVerifyResponse(Base):
    valid: bool
    reason: str
    claims: MandateClaims | None = None
    record: MandateRecord | None = None


# --------------------------------------------------------------------------
# Purchase intent + policy decision
# --------------------------------------------------------------------------


class IntentStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    GATED = "GATED"
    DENIED = "DENIED"
    PAID = "PAID"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"


class DecisionAction(str, Enum):
    AUTO_APPROVE = "auto_approve"
    GATE_FOR_HUMAN = "gate_for_human"
    DENY = "deny"


class CheckStatus(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    GATE = "gate"
    SKIPPED = "skipped"


class PolicyCheck(Base):
    """One guardrail evaluation. The audit trail is built out of these."""

    id: str
    name: str
    status: CheckStatus
    reason: str = Field(description="Human-readable explanation, safe to show a judge or a user.")
    observed: dict[str, Any] = Field(default_factory=dict)


class Decision(Base):
    action: DecisionAction
    reasons: list[str]
    checks: list[PolicyCheck]
    evaluated_at: str
    policy_version: str = "vyapaar.policy.v1"

    @property
    def allows_payment(self) -> bool:
        return self.action == DecisionAction.AUTO_APPROVE


class PurchaseIntentRequest(Base):
    mandate_token: str
    product_id: str
    qty: int = Field(default=1, ge=1)
    idempotency_key: str | None = Field(default=None, max_length=128)
    agent_rationale: str | None = Field(default=None, max_length=1000)
    offer_id: str | None = Field(
        default=None,
        max_length=64,
        description=(
            "A merchant offer the agent chose to accept, from GET /growth/offers. Only the id "
            "travels: the server re-fetches the offer and re-prices it, so nothing an agent "
            "sends can change what the offer costs."
        ),
    )


class PurchaseIntent(Base):
    intent_id: str
    mandate_id: str
    buyer_id: str
    merchant_id: str
    product_id: str
    product_title: str
    category: str
    unit_price_paise: int
    qty: int
    amount_paise: int
    status: IntentStatus
    agent_rationale: str | None = None
    created_at: str
    updated_at: str
    reserved_paise: int = 0
    offer_id: str | None = None
    # What the order would have cost at list, and what the offer took off it. Both
    # zero on an ordinary purchase, which keeps the arithmetic honest either way.
    list_amount_paise: int = 0
    discount_paise: int = 0


class PurchaseIntentResponse(Base):
    intent: PurchaseIntent
    decision: Decision
    mandate: MandateRecord
    next_action: str = Field(description="What the agent should do next, in plain words.")


class ResolveGateRequest(Base):
    intent_id: str
    approve: bool
    resolved_by: str = Field(default="dashboard-operator", max_length=120)
    note: str | None = Field(default=None, max_length=500)


class ConfirmPurchaseRequest(Base):
    intent_id: str
    mandate_token: str


class PaymentStatus(str, Enum):
    CREATED = "CREATED"
    AWAITING_PAYMENT = "AWAITING_PAYMENT"
    PAID = "PAID"
    FAILED = "FAILED"


class PaymentRecord(Base):
    payment_id: str
    intent_id: str
    rzp_order_id: str | None = None
    rzp_payment_link_id: str | None = None
    rzp_payment_id: str | None = None
    short_url: str | None = None
    amount_paise: int
    status: PaymentStatus
    mode: Literal["live", "simulated"]
    failure_reason: str | None = None
    created_at: str
    updated_at: str


class ConfirmPurchaseResponse(Base):
    intent: PurchaseIntent
    payment: PaymentRecord
    checkout_url: str | None
    message: str


# --------------------------------------------------------------------------
# Audit
# --------------------------------------------------------------------------


class AuditEvent(Base):
    """One append-only, hash-chained row.

    `hash = sha256(prev_hash + canonical_json(body))`, so any edit to a historical
    row breaks every hash after it and `GET /audit/verify` reports the break.
    """

    seq: int
    event_id: str
    ts: str
    actor: str
    event_type: str
    intent_id: str | None = None
    mandate_id: str | None = None
    amount_paise: int | None = None
    decision: str | None = None
    summary: str
    reasons: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)
    prev_hash: str
    hash: str


class AuditChainVerification(Base):
    valid: bool
    length: int
    head_hash: str | None
    broken_at_seq: int | None = None
    detail: str


# --------------------------------------------------------------------------
# Growth: merchant-side offers, campaigns and the margin gauntlet
# --------------------------------------------------------------------------
#
# The buy side above bounds what an *agent* may spend. This side bounds what the
# *merchant* may give away. A discount is a money action too: it must be
# explainable, bounded by a margin floor and a campaign budget, and gated when it
# gets deep. The two gauntlets are deliberately the same shape.


class OfferKind(str, Enum):
    BUNDLE = "bundle"        # anchor + complement, priced below the sum of parts
    VOLUME = "volume"        # unit price falls at a quantity threshold
    UPGRADE = "upgrade"      # a better item in the same category, delta stated plainly


class OfferStatus(str, Enum):
    PUBLISHED = "PUBLISHED"    # cleared the gauntlet, visible to agents
    GATED = "GATED"            # deep discount, waiting on a human
    SUPPRESSED = "SUPPRESSED"  # a sell-side guardrail refused it
    ACCEPTED = "ACCEPTED"      # a buyer agent took it
    DECLINED = "DECLINED"      # a buyer agent looked and passed
    EXPIRED = "EXPIRED"


class OfferAction(str, Enum):
    AUTO_PUBLISH = "auto_publish"
    GATE_FOR_HUMAN = "gate_for_human"
    SUPPRESS = "suppress"


class OfferLine(Base):
    """One item inside an offer, priced from the live catalog."""

    product_id: str
    title: str
    category: str
    qty: int = Field(ge=1)
    unit_price_paise: int = Field(ge=0)
    line_total_paise: int = Field(ge=0)
    is_anchor: bool = False


class OfferQuote(Base):
    """A merchant offer in the shape a buying agent can evaluate without prose.

    Every number an agent needs to decide is explicit. What is *not* here is
    deliberate: `cost_paise` and the merchant's margin never cross this boundary.
    An agent learns what it saves, never what the merchant keeps.
    """

    schema_version: Literal["vyapaar.offer.v1"] = "vyapaar.offer.v1"
    offer_id: str
    campaign_id: str
    kind: OfferKind
    anchor_product_id: str
    lines: list[OfferLine]
    list_total_paise: int = Field(ge=0, description="Sum of catalog prices, before the offer.")
    offer_total_paise: int = Field(ge=0, description="What the buyer actually pays.")
    discount_paise: int = Field(ge=0)
    discount_bps: int = Field(ge=0, description="Basis points off list. 500 = 5%.")
    headline: str
    rationale: str = Field(description="Why the merchant is making this offer, machine-readable.")
    disclosure: str = Field(description="Truthful statement of what changes if the agent accepts.")
    expires_at: str
    status: OfferStatus = OfferStatus.PUBLISHED


class OfferCheck(Base):
    """One sell-side guardrail evaluation. Mirrors `PolicyCheck` on the buy side."""

    id: str
    name: str
    status: CheckStatus
    reason: str
    observed: dict[str, Any] = Field(default_factory=dict)


class OfferDecision(Base):
    action: OfferAction
    reasons: list[str]
    checks: list[OfferCheck]
    evaluated_at: str
    policy_version: str = "vyapaar.growth.v1"

    @property
    def publishable(self) -> bool:
        return self.action == OfferAction.AUTO_PUBLISH


class EvaluatedOffer(Base):
    """An offer plus the gauntlet that judged it. This is what the dashboard renders."""

    offer: OfferQuote
    decision: OfferDecision
    margin_paise: int | None = Field(
        default=None,
        description="Merchant-private. Populated on merchant views, null on agent-facing ones.",
    )
    margin_bps: int | None = None


class Campaign(Base):
    """The bounds a merchant's growth agent operates inside.

    Same idea as a buyer's mandate, pointed the other way: a signed-off envelope of
    discount the merchant is willing to spend, with a hard margin floor underneath.
    """

    campaign_id: str
    name: str
    merchant_id: str
    status: Literal["ACTIVE", "PAUSED", "ENDED"] = "ACTIVE"
    discount_budget_paise: int = Field(gt=0, description="Total discount the campaign may give away.")
    discount_spent_paise: int = Field(default=0, ge=0)
    discount_reserved_paise: int = Field(default=0, ge=0)
    max_discount_bps: int = Field(gt=0, le=10000, description="Ceiling on any single offer.")
    floor_margin_bps: int = Field(ge=0, le=10000, description="Margin the merchant will not sell below.")
    deep_discount_gate_paise: int = Field(gt=0, description="Discounts at or above this need a human.")
    allowed_categories: list[str]
    created_at: str
    updated_at: str

    @property
    def discount_available_paise(self) -> int:
        return max(
            0, self.discount_budget_paise - self.discount_spent_paise - self.discount_reserved_paise
        )


class CampaignCreateRequest(Base):
    name: str = Field(min_length=1, max_length=200)
    discount_budget_paise: int = Field(gt=0)
    max_discount_bps: int = Field(default=1500, gt=0, le=10000)
    floor_margin_bps: int = Field(default=1200, ge=0, le=10000)
    deep_discount_gate_paise: int = Field(default=200000, gt=0)
    allowed_categories: list[str] = Field(default_factory=list)


class OfferListResponse(Base):
    """Agent-facing. Suppressed offers are named, not hidden -- an agent that asked
    deserves to know an offer existed and why it is not being made."""

    schema_version: Literal["vyapaar.offers.v1"] = "vyapaar.offers.v1"
    merchant_id: str
    anchor_product_id: str
    generated_at: str
    mandate_aware: bool = Field(
        description="True when the caller presented a mandate and offers were fitted to its bounds."
    )
    offers: list[OfferQuote]
    withheld: list[dict[str, Any]] = Field(
        default_factory=list, description="Offers the merchant's own guardrails refused, with reasons."
    )


class RevenueMetrics(Base):
    """What the merchant actually got out of the growth agent."""

    settled_gmv_paise: int
    baseline_gmv_paise: int = Field(description="What the same intents would have been worth with no offer.")
    uplift_paise: int
    uplift_bps: int
    orders: int
    aov_paise: int
    aov_without_offer_paise: int
    aov_with_offer_paise: int
    attach_rate_bps: int = Field(description="Share of settled orders that took an offer.")
    discount_given_paise: int
    margin_earned_paise: int
    offers_published: int
    offers_accepted: int
    offers_declined: int
    offers_suppressed: int
    offers_gated: int
    margin_protected_paise: int = Field(
        description="Discount the gauntlet refused to give away. Money the merchant kept."
    )


class RebalanceMove(Base):
    """One explainable change the campaign orchestrator made."""

    product_id: str
    title: str
    action: Literal["promote", "withdraw", "hold"]
    reason: str
    observed: dict[str, Any] = Field(default_factory=dict)


class RebalanceResult(Base):
    campaign_id: str
    evaluated: int
    moves: list[RebalanceMove]
    summary: str
