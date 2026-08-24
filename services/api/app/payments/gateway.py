"""Razorpay gateway, in two interchangeable implementations.

`live` talks to Razorpay in **test mode** using `rzp_test_*` keys: real Orders,
real Payment Links, real webhooks. `config.Settings` refuses to load a key that
is not a test key, so this project cannot be pointed at real money.

`simulated` is the fallback when no keys are configured. It mints identifiers in
Razorpay's own shape, serves a local checkout page, and -- importantly -- signs
its webhooks with the same HMAC-SHA256 scheme Razorpay uses. The signature
verification path is therefore genuinely exercised in both modes; the simulator
cannot skip it, because the code that consumes the webhook does not know or care
which gateway produced it.

Field names below were checked against the current Razorpay API reference:
amounts are in the smallest currency unit (paise), orders return `order_*`,
payment links return `plink_*` plus a `short_url`, and `notes` accepts at most
15 key/value pairs.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import time
from typing import Any, Literal, Protocol

from ..config import get_settings

log = logging.getLogger("agentmandi.payments.gateway")

GatewayMode = Literal["live", "simulated"]


class PaymentGatewayError(Exception):
    """Anything the gateway could not complete. Message is safe to surface."""


def _rzp_id(prefix: str) -> str:
    """Razorpay identifiers are `prefix_` plus 14 base62-ish characters."""
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return f"{prefix}_{''.join(secrets.choice(alphabet) for _ in range(14))}"


def compute_webhook_signature(raw_body: bytes, secret: str) -> str:
    """HMAC-SHA256 over the *raw* request body, keyed by the webhook secret.

    Razorpay is explicit that the body must not be parsed or re-serialised before
    signing -- a re-encoded JSON body will not match.
    """
    return hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


def verify_webhook_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    if not signature:
        return False
    expected = compute_webhook_signature(raw_body, secret)
    return hmac.compare_digest(expected, signature)


def verify_checkout_signature(order_id: str, payment_id: str, signature: str, key_secret: str) -> bool:
    """For the browser Checkout fallback: HMAC-SHA256 of `order_id|payment_id`."""
    if not signature:
        return False
    expected = hmac.new(
        key_secret.encode("utf-8"), f"{order_id}|{payment_id}".encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


class PaymentGateway(Protocol):
    mode: GatewayMode

    def create_order(
        self, *, amount_paise: int, receipt: str, notes: dict[str, str]
    ) -> dict[str, Any]: ...

    def create_payment_link(
        self,
        *,
        amount_paise: int,
        description: str,
        reference_id: str,
        notes: dict[str, str],
        callback_url: str,
        expire_by: int | None = None,
    ) -> dict[str, Any]: ...


class LiveRazorpayGateway:
    """Real Razorpay, test mode only."""

    mode: GatewayMode = "live"

    def __init__(self) -> None:
        import razorpay  # noqa: PLC0415 - only needed when keys are configured

        settings = get_settings()
        if not settings.razorpay_configured:
            raise PaymentGatewayError("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required for live mode")
        self._client = razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))
        self._client.set_app_details({"title": "AgentMandi", "version": "0.1.0"})

    def create_order(self, *, amount_paise: int, receipt: str, notes: dict[str, str]) -> dict[str, Any]:
        try:
            return dict(
                self._client.order.create(
                    {
                        "amount": amount_paise,  # smallest currency unit
                        "currency": "INR",
                        "receipt": receipt[:40],
                        "notes": notes,
                    }
                )
            )
        except Exception as exc:  # noqa: BLE001 - SDK raises a wide range of errors
            raise PaymentGatewayError(f"Razorpay order creation failed: {exc}") from exc

    def create_payment_link(
        self,
        *,
        amount_paise: int,
        description: str,
        reference_id: str,
        notes: dict[str, str],
        callback_url: str,
        expire_by: int | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "amount": amount_paise,
            "currency": "INR",
            "description": description[:2048],
            "reference_id": reference_id[:40],
            "notes": notes,
            "callback_url": callback_url,
            "callback_method": "get",
            "reminder_enable": False,
            # No customer contact details: an agent-initiated purchase should not
            # invent a phone number, and Razorpay only needs them to send reminders.
            "notify": {"sms": False, "email": False},
        }
        if expire_by:
            payload["expire_by"] = expire_by
        try:
            return dict(self._client.payment_link.create(payload))
        except Exception as exc:  # noqa: BLE001
            raise PaymentGatewayError(f"Razorpay payment link creation failed: {exc}") from exc


class SimulatedRazorpayGateway:
    """Offline stand-in with Razorpay-shaped identifiers and real HMAC signing."""

    mode: GatewayMode = "simulated"

    def create_order(self, *, amount_paise: int, receipt: str, notes: dict[str, str]) -> dict[str, Any]:
        now = int(time.time())
        return {
            "id": _rzp_id("order"),
            "entity": "order",
            "amount": amount_paise,
            "amount_paid": 0,
            "amount_due": amount_paise,
            "currency": "INR",
            "receipt": receipt[:40],
            "status": "created",
            "attempts": 0,
            "notes": notes,
            "created_at": now,
        }

    def create_payment_link(
        self,
        *,
        amount_paise: int,
        description: str,
        reference_id: str,
        notes: dict[str, str],
        callback_url: str,
        expire_by: int | None = None,
    ) -> dict[str, Any]:
        settings = get_settings()
        link_id = _rzp_id("plink")
        now = int(time.time())
        return {
            "id": link_id,
            "entity": "payment_link",
            "amount": amount_paise,
            "amount_paid": 0,
            "currency": "INR",
            "description": description[:2048],
            "reference_id": reference_id[:40],
            "status": "created",
            "notes": notes,
            "callback_url": callback_url,
            "callback_method": "get",
            "expire_by": expire_by,
            "created_at": now,
            # Points at this service's own hosted checkout page rather than Razorpay's.
            "short_url": f"{settings.public_base_url.rstrip('/')}/payments/simulator/{link_id}",
        }


def build_webhook_event(
    *,
    event: str,
    payment_link: dict[str, Any] | None,
    order: dict[str, Any] | None,
    payment: dict[str, Any] | None,
) -> dict[str, Any]:
    """Assemble a webhook body in Razorpay's nested `payload.<entity>.entity` shape."""
    payload: dict[str, Any] = {}
    contains: list[str] = []
    if payment_link is not None:
        payload["payment_link"] = {"entity": payment_link}
        contains.append("payment_link")
    if order is not None:
        payload["order"] = {"entity": order}
        contains.append("order")
    if payment is not None:
        payload["payment"] = {"entity": payment}
        contains.append("payment")
    return {
        "entity": "event",
        "account_id": "acc_AgentMandiTest",
        "event": event,
        "contains": contains,
        "payload": payload,
        "created_at": int(time.time()),
    }


def sign_event(event_body: dict[str, Any]) -> tuple[bytes, str]:
    """Serialise once and sign those exact bytes, mirroring how Razorpay signs."""
    raw = json.dumps(event_body, separators=(",", ":")).encode("utf-8")
    return raw, compute_webhook_signature(raw, get_settings().razorpay_webhook_secret)


_gateway: PaymentGateway | None = None


def get_gateway() -> PaymentGateway:
    global _gateway
    if _gateway is None:
        settings = get_settings()
        if settings.effective_payments_mode == "live":
            _gateway = LiveRazorpayGateway()
            log.info("payments: Razorpay TEST MODE (key %s)", settings.razorpay_key_id)
        else:
            _gateway = SimulatedRazorpayGateway()
            log.info("payments: local simulator (no Razorpay keys configured)")
    return _gateway


def reset_gateway() -> None:
    """Used by tests and after a settings change."""
    global _gateway
    _gateway = None
