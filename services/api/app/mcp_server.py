"""MCP server -- point any MCP client at this and it can buy from the merchant.

This is the "any agent can transact" surface. It is a thin adapter over the
merchant's public HTTP API rather than an in-process shortcut, which is
deliberate: it proves the API is genuinely the interface an outside agent uses,
and it matches how a merchant would actually ship this (the merchant runs the
API; the MCP server is the connector a buyer installs).

Four tools, mirroring the spec:

    search_catalog          discover products
    get_product             price and inspect one
    create_purchase_intent  ask permission to buy (runs every guardrail)
    confirm_purchase        pay for an approved intent

Two more make an agent's life easier: `get_merchant_info` and `check_mandate`.

Run it:
    python -m app.mcp_server                # stdio, for Claude Desktop et al.
    VYAPAAR_API_URL=http://host:8000 ... # point at a non-local merchant
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

API_URL = os.environ.get("VYAPAAR_API_URL", "http://127.0.0.1:8000").rstrip("/")
TIMEOUT = float(os.environ.get("VYAPAAR_MCP_TIMEOUT", "30"))

mcp = FastMCP("vyapaar")


def _call(method: str, path: str, **kwargs: Any) -> dict[str, Any]:
    """One place for transport errors, so every tool fails the same readable way."""
    try:
        with httpx.Client(base_url=API_URL, timeout=TIMEOUT) as client:
            response = client.request(method, path, **kwargs)
    except httpx.RequestError as exc:
        return {
            "error": "merchant_unreachable",
            "detail": f"Could not reach the Vyapaar API at {API_URL}: {exc}",
            "hint": "Start the merchant API, or set VYAPAAR_API_URL to where it runs.",
        }
    if response.status_code >= 400:
        try:
            detail = response.json().get("detail", response.text)
        except ValueError:
            detail = response.text
        return {"error": f"http_{response.status_code}", "detail": detail}
    return response.json()


def _inr(paise: int | None) -> str:
    return "unknown" if paise is None else f"INR {paise / 100:,.2f}"


@mcp.tool()
def get_merchant_info() -> dict[str, Any]:
    """Describe this merchant and how buying from it works.

    Call this first if you have not transacted here before. It reports the
    merchant identity, the money unit (integer paise), and the required sequence:
    obtain a mandate, raise an intent, then pay only if the intent is approved.
    """
    info = _call("GET", "/")
    if "error" in info:
        return info
    health = _call("GET", "/health")
    policy = _call("GET", "/policy/config")
    return {
        "merchant": info.get("merchant"),
        "currency": "INR",
        "money_unit": "integer paise (100 paise = INR 1). Never send a float.",
        "how_to_buy": [
            "1. search_catalog / get_product to find something.",
            "2. Obtain a mandate_token from the buyer (the human). You cannot mint one.",
            "3. create_purchase_intent -- this runs every guardrail and returns a decision.",
            "4. If the decision is auto_approve, call confirm_purchase to get a payment link.",
            "5. If it is gate_for_human, stop and tell the buyer a person must approve it.",
            "6. If it is deny, read the failed check and adapt. Do not retry unchanged.",
        ],
        "guardrails": policy.get("checks") if "error" not in policy else None,
        "human_review_threshold": _inr(policy.get("hitl_threshold_paise"))
        if "error" not in policy
        else None,
        "payments": {
            "mode": health.get("payments_mode"),
            "note": "Razorpay test mode only. No real money moves.",
        },
        "catalog_size": health.get("catalog_products"),
    }


@mcp.tool()
def search_catalog(
    query: str,
    max_price_paise: int | None = None,
    category: str | None = None,
    in_stock_only: bool = True,
    limit: int = 8,
) -> dict[str, Any]:
    """Search the merchant's catalog in natural language.

    Args:
        query: What you are looking for, e.g. "wireless mouse under 1500".
        max_price_paise: Hard price ceiling in paise. Applied before ranking, so
            nothing above it is returned. 150000 = INR 1,500.
        category: Restrict to one category, e.g. "electronics".
        in_stock_only: Leave True unless you specifically want unavailable items.
        limit: How many results to return.

    Each hit carries a `rationale` explaining why it matched, which is worth
    quoting when you tell the buyer why you picked something.
    """
    params: dict[str, Any] = {"q": query, "limit": limit, "in_stock_only": in_stock_only}
    if max_price_paise is not None:
        params["max_price"] = max_price_paise
    if category:
        params["category"] = category

    data = _call("GET", "/catalog/search", params=params)
    if "error" in data:
        return data
    return {
        "query": query,
        "filters_applied": data.get("filters"),
        "total_matched": data.get("total_matched"),
        "results": [
            {
                "product_id": hit["product"]["id"],
                "title": hit["product"]["title"],
                "category": hit["product"]["category"],
                "price_paise": hit["product"]["price_paise"],
                "price_display": _inr(hit["product"]["price_paise"]),
                "stock": hit["product"]["stock"],
                "attributes": hit["product"]["attributes"],
                "relevance": hit["score"],
                "why_it_matched": hit["rationale"],
            }
            for hit in data.get("results", [])
        ],
    }


@mcp.tool()
def get_product(product_id: str) -> dict[str, Any]:
    """Fetch one product's full record: price in paise, stock, and typed attributes."""
    product = _call("GET", f"/catalog/product/{product_id}")
    if "error" in product:
        return product
    return {**product, "price_display": _inr(product["price_paise"])}


@mcp.tool()
def get_offers(product_id: str, mandate_token: str | None = None) -> dict[str, Any]:
    """Ask the merchant what it will offer on a product before you buy it.

    Args:
        product_id: The product you are about to purchase.
        mandate_token: Optional but recommended. Present your mandate and the
            merchant fits its offers to what you are actually allowed to spend,
            instead of proposing purchases you would have to refuse.

    Returns published offers and, separately, the ones the merchant's own
    guardrails refused to make -- with the check that refused each. Both are worth
    reading: a withheld offer tells you where the merchant's limits are.

    Each offer carries a `disclosure` stating plainly what changes if you accept.
    Read it before accepting: a `bundle` adds an item to the order, a `volume`
    tier commits you to several units, and an `upgrade` swaps the product for a
    different one. Only accept what your instructions actually authorise.

    To accept, pass the `offer_id` to `create_purchase_intent`. Only the id
    travels -- the merchant re-prices the offer server-side, so nothing you send
    can change what it costs.
    """
    params: dict[str, Any] = {"product_id": product_id}
    if mandate_token:
        params["mandate_token"] = mandate_token

    data = _call("GET", "/growth/offers", params=params)
    if "error" in data:
        return data

    return {
        "merchant_id": data.get("merchant_id"),
        "anchor_product_id": data.get("anchor_product_id"),
        "fitted_to_your_mandate": data.get("mandate_aware"),
        "offers": [
            {
                "offer_id": offer["offer_id"],
                "kind": offer["kind"],
                "headline": offer["headline"],
                "you_pay_paise": offer["offer_total_paise"],
                "you_pay_display": _inr(offer["offer_total_paise"]),
                "list_total_paise": offer["list_total_paise"],
                "you_save_paise": offer["discount_paise"],
                "you_save_display": _inr(offer["discount_paise"]),
                "discount_percent": round(offer["discount_bps"] / 100, 2),
                "items": [
                    {
                        "product_id": line["product_id"],
                        "title": line["title"],
                        "qty": line["qty"],
                        "unit_price_paise": line["unit_price_paise"],
                    }
                    for line in offer["lines"]
                ],
                "why_the_merchant_offers_it": offer["rationale"],
                "what_changes_if_you_accept": offer["disclosure"],
                "expires_at": offer["expires_at"],
            }
            for offer in data.get("offers", [])
        ],
        "withheld": data.get("withheld", []),
        "how_to_accept": (
            "Pass the offer_id to create_purchase_intent along with your mandate token "
            "and the product_id you started from."
        ),
    }

@mcp.tool()
def create_purchase_intent(
    mandate_token: str,
    product_id: str,
    qty: int = 1,
    rationale: str | None = None,
    offer_id: str | None = None,
) -> dict[str, Any]:
    """Ask the merchant for permission to buy. This is the only route to a payment.

    Every guardrail runs here: mandate signature and expiry, merchant match,
    category allow-list, per-transaction cap, remaining budget, stock, and the
    human-review threshold. Nothing is charged by this call.

    Args:
        mandate_token: The signed mandate the buyer gave you. You cannot create
            one yourself, and editing it will fail signature verification.
        product_id: From search_catalog or get_product.
        qty: How many units.
        rationale: One sentence on why you picked this. It is recorded in the
            merchant's audit trail next to the decision, so make it truthful.
        offer_id: An offer from `get_offers` you have decided to accept. Only the
            id travels: the merchant re-fetches and re-prices the offer, and any
            drift since it was published shows up as an `offer_honoured` denial
            rather than a surprise on the invoice. Accept only what your
            instructions authorise -- a bundle or volume tier changes what you are
            buying.

    Returns a decision of `auto_approve`, `gate_for_human` or `deny`, along with
    every check and its reason. On `deny`, read `failed_check` and adapt --
    a budget denial means find something cheaper, a stock denial means find
    something else. Do not retry the same intent unchanged.
    """
    body: dict[str, Any] = {
        "mandate_token": mandate_token,
        "product_id": product_id,
        "qty": qty,
    }
    if rationale:
        body["agent_rationale"] = rationale
    if offer_id:
        body["offer_id"] = offer_id

    data = _call("POST", "/intents", json=body)
    if "error" in data:
        return data

    decision = data["decision"]
    checks = decision.get("checks", [])
    failed = next((c for c in checks if c["status"] == "fail"), None)
    gated = next((c for c in checks if c["status"] == "gate"), None)

    return {
        "intent_id": data["intent"]["intent_id"],
        "status": data["intent"]["status"],
        "decision": decision["action"],
        "amount_paise": data["intent"]["amount_paise"],
        "amount_display": _inr(data["intent"]["amount_paise"]),
        "reasons": decision["reasons"],
        "checks": [
            {"check": c["id"], "status": c["status"], "reason": c["reason"]} for c in checks
        ],
        "failed_check": failed["id"] if failed else None,
        "gated_on": gated["id"] if gated else None,
        "budget_after": {
            "spent": _inr(data["mandate"]["spent_paise"]),
            "reserved": _inr(data["mandate"]["reserved_paise"]),
            "total": _inr(data["mandate"]["total_budget_paise"]),
        },
        "next_action": data["next_action"],
    }


@mcp.tool()
def confirm_purchase(intent_id: str, mandate_token: str) -> dict[str, Any]:
    """Pay for an intent the guardrails already approved.

    Fails unless the intent is APPROVED. A denied intent cannot be paid, and a
    gated one has to be approved by a person first -- there is no override here.

    Returns a Razorpay payment link. The purchase settles only when the merchant
    receives a webhook whose signature verifies; your call returning successfully
    is not the same as the money having moved. Poll `check_intent` if you need to
    know the final state.
    """
    data = _call(
        "POST", "/intents/confirm", json={"intent_id": intent_id, "mandate_token": mandate_token}
    )
    if "error" in data:
        return data
    return {
        "intent_id": data["intent"]["intent_id"],
        "intent_status": data["intent"]["status"],
        "amount_display": _inr(data["intent"]["amount_paise"]),
        "checkout_url": data["checkout_url"],
        "razorpay_order_id": data["payment"]["rzp_order_id"],
        "razorpay_payment_link_id": data["payment"]["rzp_payment_link_id"],
        "payment_status": data["payment"]["status"],
        "message": data["message"],
    }


@mcp.tool()
def check_mandate(mandate_token: str) -> dict[str, Any]:
    """Check a mandate: is it valid, and how much can it still spend?

    Worth calling before a purchase so you can bound your search to what the
    buyer actually has left rather than discovering it at the guardrail.
    """
    data = _call("POST", "/mandate/verify", json={"mandate_token": mandate_token})
    if "error" in data:
        return data
    if not data.get("valid"):
        return {"valid": False, "reason": data.get("reason")}

    record = data["record"]
    available = (
        record["total_budget_paise"] - record["spent_paise"] - record["reserved_paise"]
    )
    return {
        "valid": True,
        "mandate_id": record["mandate_id"],
        "buyer_id": record["buyer_id"],
        "merchant_id": record["merchant_id"],
        "per_transaction_cap": _inr(record["per_txn_cap_paise"]),
        "per_txn_cap_paise": record["per_txn_cap_paise"],
        "total_budget": _inr(record["total_budget_paise"]),
        "already_spent": _inr(record["spent_paise"]),
        "held_for_in_flight": _inr(record["reserved_paise"]),
        "available_to_spend": _inr(available),
        "available_paise": max(0, available),
        "allowed_categories": record["allowed_categories"],
        "expires_at": record["expires_at"],
    }


@mcp.tool()
def check_intent(intent_id: str) -> dict[str, Any]:
    """Look up an intent's current status and the guardrail decision behind it.

    Statuses: PENDING, APPROVED, GATED, DENIED, PAID, FAILED. Use this to find
    out whether a payment actually settled, or whether a human has resolved a
    gated purchase yet.
    """
    intent = _call("GET", f"/intents/{intent_id}")
    if "error" in intent:
        return intent
    decision = _call("GET", f"/intents/{intent_id}/decision")
    return {
        "intent_id": intent["intent_id"],
        "status": intent["status"],
        "product": intent["product_title"],
        "amount_display": _inr(intent["amount_paise"]),
        "decision": decision.get("action") if "error" not in decision else None,
        "reasons": decision.get("reasons") if "error" not in decision else None,
        "created_at": intent["created_at"],
        "updated_at": intent["updated_at"],
    }


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
