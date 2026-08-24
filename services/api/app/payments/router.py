"""Payment endpoints: the Razorpay webhook sink and the local checkout simulator."""

from __future__ import annotations

import html

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse

from ..config import get_settings
from ..db import connect
from ..models import PaymentRecord
from . import service
from .gateway import get_gateway

router = APIRouter(prefix="/payments", tags=["payments"])


@router.post("/webhook", summary="Razorpay webhook sink")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str = Header(default="", alias="X-Razorpay-Signature"),
    x_razorpay_event_id: str | None = Header(default=None, alias="X-Razorpay-Event-Id"),
) -> JSONResponse:
    """Verify HMAC-SHA256 over the **raw** body, then settle.

    The body is read as bytes and never re-serialised before verification --
    re-encoding the JSON would change the signature.
    """
    raw_body = await request.body()
    try:
        result = service.handle_webhook(
            raw_body=raw_body,
            signature=x_razorpay_signature,
            event_id=x_razorpay_event_id,
        )
    except service.WebhookRejected as exc:
        # 400, not 500: the request authenticated badly, the service is fine.
        return JSONResponse(status_code=400, content={"status": "rejected", "detail": str(exc)})
    return JSONResponse(status_code=200, content=result)


@router.get("", response_model=list[PaymentRecord], summary="List payments")
def list_payments(limit: int = Query(default=50, ge=1, le=200)) -> list[PaymentRecord]:
    return service.list_payments(limit=limit)


@router.get("/intent/{intent_id}", response_model=PaymentRecord, summary="Payment for an intent")
def payment_for_intent(intent_id: str) -> PaymentRecord:
    payment = service.get_payment_for_intent(intent_id)
    if payment is None:
        raise HTTPException(status_code=404, detail=f"No payment recorded for intent {intent_id}")
    return payment


@router.post("/simulator/{payment_link_id}/pay", summary="Simulate paying a link")
def simulate_pay(payment_link_id: str, outcome: str = Query(default="success", pattern="^(success|failure)$")) -> dict:
    """Emit a properly signed webhook for a simulated link.

    Disabled automatically when real Razorpay test keys are configured.
    """
    try:
        return service.simulate_payment(payment_link_id=payment_link_id, outcome=outcome)
    except service.PaymentError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except service.WebhookRejected as exc:  # pragma: no cover - we sign these ourselves
        raise HTTPException(status_code=400, detail=str(exc)) from exc


_CHECKOUT_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentMandi test checkout</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         display: grid; place-items: center; min-height: 100vh; margin: 0;
         background: #0b0f17; color: #e6edf7; }}
  .card {{ width: min(440px, 92vw); background: #131a26; border: 1px solid #263043;
          border-radius: 16px; padding: 28px; box-shadow: 0 20px 60px rgba(0,0,0,.45); }}
  .tag {{ display:inline-block; font-size: 11px; letter-spacing:.08em; text-transform:uppercase;
         color:#9fb3d1; border:1px solid #2c3a50; border-radius:999px; padding:4px 10px;
         margin-bottom:18px; }}
  h1 {{ font-size: 19px; margin: 0 0 6px; }}
  .amount {{ font-size: 36px; font-weight: 650; margin: 14px 0 4px; letter-spacing:-.02em; }}
  .muted {{ color:#8ea3c0; font-size: 13px; margin: 0 0 20px; }}
  dl {{ display:grid; grid-template-columns: auto 1fr; gap:6px 14px; font-size:12.5px;
       margin: 0 0 22px; padding: 14px; background:#0e1523; border-radius:10px; }}
  dt {{ color:#8ea3c0; }} dd {{ margin:0; font-family: ui-monospace, monospace; overflow-wrap:anywhere; }}
  button {{ width:100%; padding: 13px; border-radius:10px; border:0; font-size:14.5px;
           font-weight:600; cursor:pointer; margin-bottom:10px; }}
  .pay {{ background:#2f7d4f; color:#fff; }}
  .fail {{ background:transparent; color:#e88; border:1px solid #7a3b3b; }}
  .note {{ font-size:11.5px; color:#7d90ac; line-height:1.5; margin-top:16px; }}
  #out {{ margin-top:14px; font-size:12.5px; font-family:ui-monospace,monospace;
         white-space:pre-wrap; color:#9fd3b0; }}
</style></head><body>
<div class="card">
  <span class="tag">Razorpay simulator &middot; no real money</span>
  <h1>{title}</h1>
  <div class="amount">&#8377;{amount}</div>
  <p class="muted">{description}</p>
  <dl>
    <dt>Link</dt><dd>{link_id}</dd>
    <dt>Order</dt><dd>{order_id}</dd>
    <dt>Intent</dt><dd>{intent_id}</dd>
  </dl>
  <button class="pay"  onclick="go('success')">Pay with test card</button>
  <button class="fail" onclick="go('failure')">Simulate a declined card</button>
  <div id="out"></div>
  <p class="note">Either button emits a webhook signed with HMAC-SHA256 over the raw body,
  exactly as Razorpay signs its own. The server verifies that signature before changing
  any state, so this shortcut cannot skip the check it is demonstrating.</p>
</div>
<script>
async function go(outcome) {{
  const out = document.getElementById('out');
  out.textContent = 'Sending signed webhook...';
  const res = await fetch('/payments/simulator/{link_id}/pay?outcome=' + outcome, {{method:'POST'}});
  const body = await res.json();
  out.textContent = JSON.stringify(body, null, 2);
}}
</script></body></html>"""


@router.get("/simulator/{payment_link_id}", response_class=HTMLResponse, summary="Simulated checkout page")
def simulator_page(payment_link_id: str) -> HTMLResponse:
    """A stand-in for Razorpay's hosted payment page, served locally."""
    if get_gateway().mode != "simulated":
        raise HTTPException(
            status_code=404,
            detail="Simulator disabled: real Razorpay test keys are configured, so use the real link.",
        )
    with connect() as conn:
        row = conn.execute(
            "SELECT p.*, i.product_title, i.qty FROM payment p "
            "JOIN purchase_intent i ON i.intent_id = p.intent_id "
            "WHERE p.rzp_payment_link_id = ? ORDER BY p.created_at DESC LIMIT 1",
            (payment_link_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"No payment link {payment_link_id}")

    settings = get_settings()
    page = _CHECKOUT_PAGE.format(
        title=html.escape(settings.merchant_name),
        amount=f"{row['amount_paise'] / 100:,.2f}",
        description=html.escape(f"{row['qty']} x {row['product_title']}"),
        link_id=html.escape(payment_link_id),
        order_id=html.escape(row["rzp_order_id"] or "-"),
        intent_id=html.escape(row["intent_id"]),
    )
    return HTMLResponse(content=page)
