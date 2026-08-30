"""Catalog retrieval, the agent's recovery behaviour, and the HTTP surface."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.agent import buyer
from app.catalog import store as catalog
from app.config import get_settings
from app.intents import service as intents
from app.main import app
from app.mandate import service as mandates
from app.models import IntentStatus, MandateIssueRequest
from app.policy.engine import ORDERED_CHECKS

from .conftest import HEADPHONES, KEYBOARD, MOUSE, SILENT_MOUSE

client = TestClient(app)


# ------------------------------------------------------------------- catalog


def test_seed_catalog_loads():
    assert catalog.product_count() == 33
    assert set(catalog.list_categories()) == {"electronics", "office", "home_kitchen", "fitness"}


def test_search_finds_the_obvious_match():
    hits, _, _ = catalog.search(query="wireless mouse", limit=5)
    assert hits[0].product.id == MOUSE


def test_price_ceiling_is_a_hard_filter():
    hits, filters, _ = catalog.search(query="keyboard", max_price_paise=300_000, limit=10)
    assert filters["max_price_paise"] == 300_000
    assert all(h.product.price_paise <= 300_000 for h in hits)


def test_price_hint_is_parsed_out_of_natural_language():
    for phrase, expected in [
        ("wireless mouse under 1500", 150_000),
        ("something below Rs 2,000", 200_000),
        ("a keyboard up to 3000", 300_000),
    ]:
        assert catalog.parse_price_hint_paise(phrase) == expected
    assert catalog.parse_price_hint_paise("just a mouse") is None


def test_inferred_ceiling_is_reported_not_applied_silently():
    _, filters, _ = catalog.search(query="mouse under 1000")
    assert filters["max_price_paise"] == 100_000
    assert filters["max_price_inferred_from_query"] is True


def test_out_of_stock_products_can_be_excluded():
    hits, _, _ = catalog.search(query="silent click mouse", in_stock_only=True, limit=10)
    assert SILENT_MOUSE not in {h.product.id for h in hits}


def test_every_hit_explains_itself():
    hits, _, _ = catalog.search(query="mechanical keyboard", limit=5)
    assert all(h.rationale.strip() for h in hits)


def test_search_is_deterministic():
    """Same query, same ranking -- the demo must not depend on luck."""
    first = [h.product.id for h in catalog.search(query="wireless keyboard", limit=5)[0]]
    second = [h.product.id for h in catalog.search(query="wireless keyboard", limit=5)[0]]
    assert first == second


# --------------------------------------------------------------- agent recovery


def test_agent_completes_a_straightforward_purchase(mandate_token):
    result = buyer.run_goal(goal="buy a wireless mouse under 1500", mandate_token=mandate_token)
    assert result.outcome == "paid"
    assert result.intent_id
    assert intents.get_intent(result.intent_id).status == IntentStatus.PAID


def test_agent_stops_at_a_human_gate_rather_than_paying():
    token = mandates.issue(
        MandateIssueRequest(
            buyer_id="buyer_test",
            merchant_id=get_settings().merchant_id,
            per_txn_cap_paise=900_000,
            total_budget_paise=1_500_000,
            allowed_categories=["electronics"],
            ttl_hours=24,
        )
    ).mandate_token
    result = buyer.run_goal(goal="buy noise cancelling headphones", mandate_token=token)
    assert result.outcome == "awaiting_human"
    assert intents.get_intent(result.intent_id).status == IntentStatus.GATED


def test_agent_recovers_when_the_item_sells_out_mid_run(mandate_token):
    """The stock-out race: the agent re-searches instead of failing the run."""
    catalog.set_stock(MOUSE, 1)
    seen: dict[str, str] = {}

    def sell_it_out(choice) -> None:
        if not seen:
            seen["id"] = choice.product.id
            catalog.set_stock(choice.product.id, 0)

    result = buyer.run_goal(
        goal="buy a wireless mouse under 2000",
        mandate_token=mandate_token,
        before_intent=sell_it_out,
    )
    actions = [s.action for s in result.steps]
    assert "denied" in actions
    assert "replan" in actions
    assert result.outcome == "paid"


def test_agent_gives_up_cleanly_when_nothing_fits():
    """No infinite retry loop: it explains and stops."""
    tiny = mandates.issue(
        MandateIssueRequest(
            buyer_id="buyer_test",
            merchant_id=get_settings().merchant_id,
            per_txn_cap_paise=100,
            total_budget_paise=100,
            allowed_categories=["electronics"],
            ttl_hours=24,
        )
    ).mandate_token
    result = buyer.run_goal(goal="buy a mechanical keyboard", mandate_token=tiny)
    assert result.outcome in ("abandoned", "denied")
    assert result.attempts <= buyer.MAX_ATTEMPTS
    assert result.message


def test_agent_declines_rather_than_substituting_something_unrelated(mandate_token):
    """Asked for a yoga mat under an electronics/office mandate.

    The closest match is category-blocked, and the nearest purchasable item is a
    far weaker match. The agent must explain that rather than spend the buyer's
    money on something they did not ask for.
    """
    result = buyer.run_goal(goal="buy a yoga mat", mandate_token=mandate_token)
    assert result.outcome == "abandoned"
    assert "does not authorise" in result.message
    assert not [i for i in intents.list_intents(limit=50) if i.status == IntentStatus.PAID]


def test_no_denied_intent_is_ever_paid(mandate_token):
    """Whatever the agent decides, the guardrail is what actually holds."""
    for goal in ("buy a yoga mat", "buy a wireless mouse under 1500", "buy a cast iron tawa"):
        buyer.run_goal(goal=goal, mandate_token=mandate_token)
    for intent in intents.list_intents(limit=100):
        if intent.status == IntentStatus.PAID:
            assert intents.get_decision(intent.intent_id).allows_payment


# ------------------------------------------------------------------ HTTP API


def test_health_reports_configuration():
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["catalog_products"] == 33
    assert body["payments_mode"] == "simulated"
    assert body["audit_chain_valid"] is True


def test_root_tells_a_visiting_agent_where_to_start():
    body = client.get("/").json()
    assert body["money_unit"].startswith("integer paise")
    assert "/catalog/feed" in body["start_here"]["feed"]


def test_catalog_feed_paginates():
    page = client.get("/catalog/feed", params={"limit": 10, "offset": 0}).json()
    assert page["total"] == 33
    assert len(page["products"]) == 10
    assert page["next_offset"] == 10
    last = client.get("/catalog/feed", params={"limit": 10, "offset": 30}).json()
    assert last["next_offset"] is None


def test_feed_prices_are_integers():
    """A float rupee amount anywhere in the money path is a bug."""
    page = client.get("/catalog/feed", params={"limit": 50}).json()
    assert all(isinstance(p["price_paise"], int) for p in page["products"])


def test_unknown_product_is_a_404():
    assert client.get("/catalog/product/prod_nope").status_code == 404


def test_issue_and_verify_over_http():
    issued = client.post(
        "/mandate/issue",
        json={
            "buyer_id": "buyer_http",
            "merchant_id": get_settings().merchant_id,
            "per_txn_cap_paise": 300_000,
            "total_budget_paise": 1_000_000,
            "allowed_categories": ["electronics"],
            "ttl_hours": 24,
        },
    ).json()
    verified = client.post(
        "/mandate/verify", json={"mandate_token": issued["mandate_token"]}
    ).json()
    assert verified["valid"] is True


def test_policy_simulate_writes_nothing(mandate_token):
    before = len(intents.list_intents(limit=100))
    decision = client.post(
        "/policy/simulate",
        json={"mandate_token": mandate_token, "product_id": KEYBOARD, "qty": 1},
    ).json()
    assert decision["action"] in ("auto_approve", "gate_for_human", "deny")
    assert len(intents.list_intents(limit=100)) == before


def test_intent_decision_endpoint_lists_every_check(mandate_token):
    created = client.post(
        "/intents", json={"mandate_token": mandate_token, "product_id": MOUSE, "qty": 1}
    ).json()
    decision = client.get(f"/intents/{created['intent']['intent_id']}/decision").json()
    assert len(decision["checks"]) == len(ORDERED_CHECKS)
    assert all(c["reason"] for c in decision["checks"])


def test_confirm_rejects_an_unapproved_intent(mandate_token):
    created = client.post(
        "/intents", json={"mandate_token": mandate_token, "product_id": HEADPHONES, "qty": 1}
    ).json()
    response = client.post(
        "/intents/confirm",
        json={"intent_id": created["intent"]["intent_id"], "mandate_token": mandate_token},
    )
    assert response.status_code == 409


def test_webhook_with_a_bad_signature_returns_400():
    response = client.post(
        "/payments/webhook",
        content=b'{"event":"payment_link.paid"}',
        headers={"X-Razorpay-Signature": "nope"},
    )
    assert response.status_code == 400
    assert response.json()["status"] == "rejected"


def test_idempotency_key_returns_the_same_intent(mandate_token):
    body = {
        "mandate_token": mandate_token,
        "product_id": MOUSE,
        "qty": 1,
        "idempotency_key": "abc-123",
    }
    first = client.post("/intents", json=body).json()
    second = client.post("/intents", json=body).json()
    assert first["intent"]["intent_id"] == second["intent"]["intent_id"]


def test_audit_endpoints_agree_with_each_other(mandate_token):
    client.post("/intents", json={"mandate_token": mandate_token, "product_id": MOUSE, "qty": 1})
    events = client.get("/audit/events", params={"limit": 100}).json()
    stats = client.get("/audit/stats").json()
    verify = client.get("/audit/verify").json()
    assert stats["total_events"] == len(events)
    assert verify["valid"] is True
    assert stats["head_hash"] == verify["head_hash"]


def test_demo_scenarios_are_all_runnable():
    """Every scenario in the seed file has a runner behind it.

    The count is read from the registry rather than hard-coded, so adding a
    scenario cannot leave a listed-but-unrunnable entry in the dashboard.
    """
    from app.demo.router import RUNNERS

    listing = client.get("/demo/scenarios").json()
    assert listing["count"] == len(RUNNERS)
    assert all(s["runnable"] for s in listing["scenarios"])
    assert {s["id"] for s in listing["scenarios"]} == set(RUNNERS)
