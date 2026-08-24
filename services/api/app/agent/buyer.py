"""The external buyer agent: the demo driver.

Given a goal like "buy a wireless mouse under 1500", it searches the catalog,
picks something with a stated reason, raises a purchase intent, and pays -- but
only ever through the guardrails. The agent has no path to the payment service
that does not pass `POST /intents` first, which is the whole point: the buyer
agent is untrusted, and the policy engine is what makes it safe to run.

Recovery is the interesting part. When the guardrails deny an intent, the agent
reads *which* check failed and re-plans against that specific bound -- a budget
denial becomes a cheaper search, an out-of-stock denial excludes that product, a
category denial narrows to the categories the mandate actually allows. It retries
once and then stops with a clear explanation rather than hammering the merchant.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from ..catalog import store as catalog
from ..intents import service as intents
from ..mandate import service as mandates
from ..models import (
    Base,
    CheckStatus,
    Decision,
    DecisionAction,
    MandateRecord,
    PurchaseIntentRequest,
    ScoredProduct,
)
from ..payments import service as payments
from ..payments.gateway import get_gateway
from .llm import LLMUnavailable, describe_llm, get_llm

log = logging.getLogger("agentmandi.agent.buyer")

MAX_ATTEMPTS = 2

# An agent that cannot buy what was asked for should say so, not quietly buy
# something else. If the closest purchasable item is far less relevant than the
# best match overall, or barely relevant at all, the agent declines instead.
RELEVANCE_FLOOR = 0.15
SUBSTITUTION_RATIO = 0.5


def _inr(paise: int) -> str:
    return f"INR {paise / 100:,.2f}"


class AgentStep(Base):
    step: int
    action: str
    thought: str
    detail: dict[str, Any] = {}


class AgentRunResult(Base):
    goal: str
    mandate_id: str
    planner: str
    outcome: Literal["paid", "awaiting_payment", "awaiting_human", "denied", "abandoned", "error"]
    message: str
    steps: list[AgentStep]
    intent_id: str | None = None
    checkout_url: str | None = None
    attempts: int = 0


@dataclass
class _Plan:
    query: str
    max_price_paise: int | None
    category: str | None = None
    exclude_product_ids: set[str] = field(default_factory=set)
    note: str = ""


SYSTEM_PROMPT = """You are a buyer agent shopping on behalf of a person at a single merchant.
You are given a goal, the buyer's spending mandate, and a shortlist of candidate products.

Choose at most one product. Respect the mandate: never pick a product whose category is
outside the allow-list, whose price exceeds the per-transaction cap, or that is out of stock.
Prefer the option that best satisfies the goal, breaking ties toward the cheaper item.

Reply with a single JSON object and nothing else:
{"product_id": "<id or null>", "rationale": "<one sentence on why this one>", "decline_reason": "<only if product_id is null>"}"""


class BuyerAgent:
    """Stateless per-run; every call re-reads live catalog and mandate state."""

    def __init__(self) -> None:
        self._llm = get_llm()
        self.planner = describe_llm()["provider"] if self._llm else "deterministic"

    # -- planning ---------------------------------------------------------

    def _initial_plan(self, goal: str, mandate: MandateRecord) -> _Plan:
        """Turn a goal into a search. The mandate's own caps bound the search up front."""
        inferred = catalog.parse_price_hint_paise(goal)
        ceiling = min(x for x in (inferred, mandate.per_txn_cap_paise, mandate.available_paise) if x)
        note = f"Searching within {_inr(ceiling)}"
        if ceiling == mandate.available_paise and inferred and inferred > ceiling:
            note += " (the mandate's remaining budget, which is tighter than the stated budget)"
        elif ceiling == mandate.per_txn_cap_paise and inferred and inferred > ceiling:
            note += " (the mandate's per-transaction cap, which is tighter than the stated budget)"
        return _Plan(query=goal, max_price_paise=ceiling, note=note)

    def _replan_after_denial(
        self, plan: _Plan, decision: Decision, product_id: str, mandate: MandateRecord
    ) -> _Plan | None:
        """Map the failed guardrail onto a narrower search. None means give up."""
        failed = next((c for c in decision.checks if c.status == CheckStatus.FAIL), None)
        if failed is None:
            return None

        exclude = plan.exclude_product_ids | {product_id}

        if failed.id == "budget_remaining":
            available = int(failed.observed.get("available_paise", 0))
            if available <= 0:
                return None
            return _Plan(
                query=plan.query,
                max_price_paise=available,
                category=plan.category,
                exclude_product_ids=exclude,
                note=f"Re-searching under the {_inr(available)} the mandate actually has left",
            )
        if failed.id == "per_txn_cap":
            cap = int(failed.observed.get("per_txn_cap_paise", 0))
            return _Plan(
                query=plan.query,
                max_price_paise=cap,
                category=plan.category,
                exclude_product_ids=exclude,
                note=f"Re-searching under the {_inr(cap)} per-transaction cap",
            )
        if failed.id == "stock_available":
            return _Plan(
                query=plan.query,
                max_price_paise=plan.max_price_paise,
                category=plan.category,
                exclude_product_ids=exclude,
                note="That item is out of stock; looking for an alternative",
            )
        if failed.id == "category_allowed":
            allowed = mandate.allowed_categories
            return _Plan(
                query=plan.query,
                max_price_paise=plan.max_price_paise,
                category=allowed[0] if len(allowed) == 1 else None,
                exclude_product_ids=exclude,
                note=f"That category is not authorised; restricting to {allowed}",
            )
        # merchant_match, mandate_valid and product_exists are not recoverable by re-searching.
        return None

    # -- selection --------------------------------------------------------

    @staticmethod
    def _why_blocked(hit: ScoredProduct, mandate: MandateRecord) -> str:
        if not hit.product.in_stock:
            return f"{hit.product.title} is out of stock"
        if hit.product.category not in mandate.allowed_categories:
            return (
                f"{hit.product.title} is in the '{hit.product.category}' category, which this "
                f"mandate does not authorise (it allows {mandate.allowed_categories})"
            )
        if hit.product.price_paise > mandate.per_txn_cap_paise:
            return (
                f"{hit.product.title} at {_inr(hit.product.price_paise)} is over the "
                f"{_inr(mandate.per_txn_cap_paise)} per-transaction cap"
            )
        return f"{hit.product.title} is not purchasable under this mandate"

    def _select(
        self, goal: str, hits: list[ScoredProduct], mandate: MandateRecord, plan: _Plan
    ) -> tuple[ScoredProduct | None, str]:
        considered = [hit for hit in hits if hit.product.id not in plan.exclude_product_ids]
        eligible = [
            hit
            for hit in considered
            if hit.product.in_stock
            and hit.product.category in mandate.allowed_categories
            and hit.product.price_paise <= mandate.per_txn_cap_paise
        ]

        if not eligible:
            if not considered:
                return None, "The catalog returned nothing that matches this goal."
            blocked = "; ".join(self._why_blocked(hit, mandate) for hit in considered[:3])
            return None, f"Nothing here is buyable under this mandate: {blocked}."

        best = eligible[0]
        top = considered[0]

        # Guard against buying something only tangentially related to the request.
        if best.score < RELEVANCE_FLOOR:
            return None, (
                f"Nothing in this merchant's catalog is a close enough match for '{goal}'. "
                f"The best I found was {best.product.title}, which is only loosely related, "
                "so I have not spent anything."
            )
        if top.product.id != best.product.id and best.score < top.score * SUBSTITUTION_RATIO:
            return None, (
                f"The closest match to '{goal}' is {top.product.title}, but "
                f"{self._why_blocked(top, mandate)}. The nearest thing I am allowed to buy is "
                f"{best.product.title}, which is a poor substitute, so I have not bought it. "
                "Widen the mandate or pick something else."
            )

        if self._llm is not None:
            try:
                return self._select_with_llm(goal, eligible, mandate)
            except LLMUnavailable as exc:
                log.warning("LLM selection failed (%s); falling back to ranked order", exc)

        return best, (
            f"Top-ranked match at {_inr(best.product.price_paise)}, in stock, inside the "
            f"{_inr(mandate.per_txn_cap_paise)} per-transaction cap. Retrieval said: {best.rationale}"
        )

    def _select_with_llm(
        self, goal: str, eligible: list[ScoredProduct], mandate: MandateRecord
    ) -> tuple[ScoredProduct | None, str]:
        assert self._llm is not None
        catalogue = [
            {
                "product_id": hit.product.id,
                "title": hit.product.title,
                "category": hit.product.category,
                "price_inr": hit.product.price_paise / 100,
                "stock": hit.product.stock,
                "attributes": hit.product.attributes,
                "why_it_matched": hit.rationale,
            }
            for hit in eligible[:8]
        ]
        user = (
            f"Goal: {goal}\n\n"
            f"Mandate: per-transaction cap {_inr(mandate.per_txn_cap_paise)}, "
            f"budget remaining {_inr(mandate.available_paise)}, "
            f"allowed categories {mandate.allowed_categories}.\n\n"
            f"Candidates:\n{catalogue}"
        )
        reply = self._llm.complete_json(system=SYSTEM_PROMPT, user=user)
        chosen_id = reply.get("product_id")
        if not chosen_id:
            return None, str(reply.get("decline_reason") or "The model declined to pick anything.")
        match = next((hit for hit in eligible if hit.product.id == chosen_id), None)
        if match is None:
            # The model named something outside the shortlist. Do not trust it.
            log.warning("model picked %s which was not offered; using ranked order", chosen_id)
            return eligible[0], (
                f"Model proposed an off-list product ({chosen_id}), which was rejected; "
                f"fell back to the top-ranked eligible match."
            )
        return match, str(reply.get("rationale") or "Selected by the buyer agent.")

    # -- the run ----------------------------------------------------------

    def run(
        self,
        *,
        goal: str,
        mandate_token: str,
        auto_pay: bool = True,
        before_intent: Callable[[ScoredProduct], None] | None = None,
    ) -> AgentRunResult:
        """Run the agent to completion.

        `before_intent` is a test seam: it fires after a product is chosen but
        before the intent is raised, which is where the demo stages a concurrent
        stock-out. Nothing in production passes it.
        """
        steps: list[AgentStep] = []
        step_no = 0

        def add(action: str, thought: str, detail: dict[str, Any] | None = None) -> None:
            nonlocal step_no
            step_no += 1
            steps.append(AgentStep(step=step_no, action=action, thought=thought, detail=detail or {}))

        verification = mandates.verify(mandate_token)
        if not verification.valid or verification.record is None:
            add("abort", f"I cannot act: {verification.reason}")
            return AgentRunResult(
                goal=goal,
                mandate_id="(none)",
                planner=self.planner,
                outcome="error",
                message=verification.reason,
                steps=steps,
            )

        mandate = verification.record
        add(
            "check_mandate",
            (
                f"I hold a mandate for {mandate.buyer_id} at {mandate.merchant_id}: "
                f"{_inr(mandate.available_paise)} of {_inr(mandate.total_budget_paise)} still available, "
                f"{_inr(mandate.per_txn_cap_paise)} max per purchase, categories {mandate.allowed_categories}."
            ),
            {"mandate": mandate.model_dump()},
        )

        plan = self._initial_plan(goal, mandate)
        attempts = 0

        while attempts < MAX_ATTEMPTS:
            attempts += 1
            mandate = mandates.get_record(mandate.mandate_id) or mandate

            add("search", plan.note or f"Searching for '{plan.query}'", {
                "query": plan.query,
                "max_price_paise": plan.max_price_paise,
                "category": plan.category,
                "excluded": sorted(plan.exclude_product_ids),
            })
            hits, filters, matched = catalog.search(
                query=plan.query,
                max_price_paise=plan.max_price_paise,
                category=plan.category,
                limit=8,
            )
            add(
                "search_results",
                f"{matched} product(s) matched; reviewing the top {len(hits)}.",
                {
                    "filters": filters,
                    "results": [
                        {
                            "product_id": h.product.id,
                            "title": h.product.title,
                            "price_paise": h.product.price_paise,
                            "stock": h.product.stock,
                            "score": h.score,
                            "rationale": h.rationale,
                        }
                        for h in hits
                    ],
                },
            )

            choice, rationale = self._select(goal, hits, mandate, plan)
            if choice is None:
                add("abandon", rationale)
                return AgentRunResult(
                    goal=goal,
                    mandate_id=mandate.mandate_id,
                    planner=self.planner,
                    outcome="abandoned",
                    message=rationale,
                    steps=steps,
                    attempts=attempts,
                )

            add(
                "select",
                f"Choosing {choice.product.title} at {_inr(choice.product.price_paise)}. {rationale}",
                {"product_id": choice.product.id, "price_paise": choice.product.price_paise},
            )

            if before_intent is not None:
                before_intent(choice)

            response = intents.create_intent(
                PurchaseIntentRequest(
                    mandate_token=mandate_token,
                    product_id=choice.product.id,
                    qty=1,
                    agent_rationale=rationale,
                )
            )
            decision = response.decision
            add(
                "purchase_intent",
                (
                    f"Raised intent {response.intent.intent_id} for {_inr(response.intent.amount_paise)}. "
                    f"Guardrails: {decision.action.value.upper()}."
                ),
                {
                    "intent_id": response.intent.intent_id,
                    "decision": decision.action.value,
                    "checks": [
                        {"id": c.id, "status": c.status.value, "reason": c.reason}
                        for c in decision.checks
                    ],
                },
            )

            if decision.action == DecisionAction.GATE_FOR_HUMAN:
                message = (
                    f"{choice.product.title} at {_inr(response.intent.amount_paise)} needs a human to "
                    f"sign off: {decision.reasons[0] if decision.reasons else 'high-value purchase.'} "
                    "I have stopped and reserved the budget while someone decides."
                )
                add("await_human", message, {"intent_id": response.intent.intent_id})
                return AgentRunResult(
                    goal=goal,
                    mandate_id=mandate.mandate_id,
                    planner=self.planner,
                    outcome="awaiting_human",
                    message=message,
                    steps=steps,
                    intent_id=response.intent.intent_id,
                    attempts=attempts,
                )

            if decision.action == DecisionAction.DENY:
                reason = decision.reasons[0] if decision.reasons else "a guardrail refused it."
                add("denied", f"The merchant's guardrails refused that purchase. {reason}")
                next_plan = self._replan_after_denial(plan, decision, choice.product.id, mandate)
                if next_plan is None or attempts >= MAX_ATTEMPTS:
                    message = (
                        f"I could not complete this purchase. {reason} "
                        + (
                            "I retried once with a narrower search and still could not find "
                            "something that clears the mandate, so I have stopped rather than "
                            "keep trying."
                            if next_plan is not None
                            else "This is not something a different product would fix, so I stopped."
                        )
                    )
                    add("abort", message)
                    return AgentRunResult(
                        goal=goal,
                        mandate_id=mandate.mandate_id,
                        planner=self.planner,
                        outcome="denied",
                        message=message,
                        steps=steps,
                        intent_id=response.intent.intent_id,
                        attempts=attempts,
                    )
                add("replan", next_plan.note, {"previous_reason": reason})
                plan = next_plan
                continue

            # Approved: this is the only branch that may touch the payment service.
            confirmation = payments.start_checkout(
                intent_id=response.intent.intent_id, mandate_token=mandate_token
            )
            add(
                "confirm_purchase",
                (
                    f"Approved, so I opened a Razorpay checkout for {_inr(response.intent.amount_paise)} "
                    f"({confirmation.payment.mode} mode)."
                ),
                {
                    "rzp_order_id": confirmation.payment.rzp_order_id,
                    "rzp_payment_link_id": confirmation.payment.rzp_payment_link_id,
                    "checkout_url": confirmation.checkout_url,
                },
            )

            if auto_pay and get_gateway().mode == "simulated":
                result = payments.simulate_payment(
                    payment_link_id=confirmation.payment.rzp_payment_link_id or "", outcome="success"
                )
                if result.get("status") == "paid":
                    final = mandates.get_record(mandate.mandate_id)
                    message = (
                        f"Bought {choice.product.title} for {_inr(response.intent.amount_paise)}. "
                        + (
                            f"{_inr(final.spent_paise)} of {_inr(final.total_budget_paise)} spent, "
                            f"{_inr(final.available_paise)} left."
                            if final
                            else ""
                        )
                    )
                    add("paid", message, {"intent_id": response.intent.intent_id})
                    return AgentRunResult(
                        goal=goal,
                        mandate_id=mandate.mandate_id,
                        planner=self.planner,
                        outcome="paid",
                        message=message,
                        steps=steps,
                        intent_id=response.intent.intent_id,
                        checkout_url=confirmation.checkout_url,
                        attempts=attempts,
                    )

            message = (
                f"{choice.product.title} is approved and a payment link is ready for "
                f"{_inr(response.intent.amount_paise)}. It settles once Razorpay sends a "
                "webhook whose signature verifies."
            )
            add("awaiting_payment", message, {"checkout_url": confirmation.checkout_url})
            return AgentRunResult(
                goal=goal,
                mandate_id=mandate.mandate_id,
                planner=self.planner,
                outcome="awaiting_payment",
                message=message,
                steps=steps,
                intent_id=response.intent.intent_id,
                checkout_url=confirmation.checkout_url,
                attempts=attempts,
            )

        message = "I ran out of attempts without finding anything that clears the mandate."
        add("abort", message)
        return AgentRunResult(
            goal=goal,
            mandate_id=mandate.mandate_id,
            planner=self.planner,
            outcome="abandoned",
            message=message,
            steps=steps,
            attempts=attempts,
        )


def run_goal(
    *,
    goal: str,
    mandate_token: str,
    auto_pay: bool = True,
    before_intent: Callable[[ScoredProduct], None] | None = None,
) -> AgentRunResult:
    return BuyerAgent().run(
        goal=goal,
        mandate_token=mandate_token,
        auto_pay=auto_pay,
        before_intent=before_intent,
    )
