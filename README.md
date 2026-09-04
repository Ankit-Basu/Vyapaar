<div align="center">

# `[₹]` Vyapaar

### *Both sides of the counter, bounded.*

**An agent-commerce layer for a Razorpay merchant. An outside AI agent can discover the catalog, prove it holds a human's consent, clear nine guardrails and pay — and the merchant runs a growth agent of its own that builds offers, bounded by nine more. Every money action on both sides is explainable, capped, gated, and written to one tamper-evident audit chain.**

<br/>

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![Razorpay](https://img.shields.io/badge/Razorpay-Test_Mode-072654?style=for-the-badge&logo=razorpay&logoColor=white)](https://razorpay.com)
[![MCP](https://img.shields.io/badge/MCP-8_tools-E8710A?style=for-the-badge)](https://modelcontextprotocol.io)
[![Tests](https://img.shields.io/badge/tests-178_passing-34d399?style=for-the-badge)](#-test-suite)
[![License](https://img.shields.io/badge/License-MIT-A855F7?style=for-the-badge)](LICENSE)

<br/>

### ▶ **[Open the live control room](https://vyapaar-web.vercel.app/dashboard)**

<sub>Runs entirely in Razorpay **test mode**. [`config.py`](services/api/app/config.py) refuses any key that is not `rzp_test_*`, so this cannot be pointed at real money.</sub>

<br/>

**[Quickstart](#-quickstart) · [Two gauntlets](#-two-gauntlets-one-shape) · [Demo script](docs/DEMO_FLOW.md) · [Project & challenges](docs/PROJECT.md) · [Deploy](docs/DEPLOY.md)**

</div>

<br/>

---

## 🎯 The problem, in one line

Razorpay's own pilots put conversational checkout **inside** a merchant's app. Track 01 asks for two things: make a merchant **transactable by an AI buyer**, and **grow that merchant's revenue**. Almost every answer picks one.

Vyapaar does both — and the reason it can is that the two turn out to be the same engineering problem pointed in opposite directions.

> An agent walks into a store it has never seen. It has to discover what is sold, prove it has a human's permission, pass every guardrail, pay on real banking rails, and leave a receipt proving exactly what happened and why.
>
> Meanwhile the merchant has to actually *sell* to it — without lying about a discount, selling below cost, or pushing the agent at something its owner forbade.

**A discount is a money action in exactly the same sense a purchase is.** So it gets the same treatment: an ordered gauntlet of deterministic checks, a ledger that holds before it gives, a human gate when it goes deep, and a row on the same hash chain.

<br/>

---

## 🧩 Two gauntlets, one shape

```
        BUY SIDE                                   SELL SIDE
   what an agent may spend                  what a merchant may give away
   ─────────────────────────                ─────────────────────────────
1  mandate_valid                         1  campaign_active
2  merchant_match                        2  category_in_campaign
3  offer_honoured        ◄───────────►   3  offer_integrity
4  product_exists                        4  margin_floor
5  category_allowed                      5  discount_cap
6  per_txn_cap                           6  stock_cover
7  budget_remaining                      7  campaign_budget
8  stock_available                       8  buyer_bounds  ◄── reads the mandate
9  high_value_gate  ── human ──►         9  deep_discount_gate ── human ──►

   auto_approve │ gate_for_human │ deny     auto_publish │ gate_for_human │ suppress
```

Both engines are **pure functions** — no database, no network. That is what makes every check unit-testable in isolation and every decision reproducible from its audit row alone. The first failure short-circuits, and the remaining checks are recorded as `skipped` rather than silently dropped, so the trail shows exactly how far evaluation got and why it stopped.

| | Buy side | Sell side |
|:---|:---|:---|
| **Authority comes from** | a buyer's signed mandate (JWT) | a merchant's campaign |
| **The envelope** | budget, per-txn cap, categories | discount budget, max %, margin floor |
| **Accounting** | reserve → settle \| release | reserve → settle \| release |
| **Human gate at** | ≥ ₹5,000 per purchase | ≥ ₹800 of discount |
| **Engine** | [`policy/engine.py`](services/api/app/policy/engine.py) | [`growth/engine.py`](services/api/app/growth/engine.py) |

<br/>

### Four checks worth reading twice

**`product_exists` — the agent cannot name its own price.** The intent API does not *accept* an amount. `POST /intents` takes a product id and a quantity; the server prices it from its own catalog. There is no field to lie in.

**`offer_integrity` — the merchant cannot fake a saving.** Every offer is re-priced against the live catalog before publication. An inflated "was" price does not reconcile, so the offer is never made. A person can smell a fake discount; a machine buyer cannot, which makes proving it the merchant's job.

**`margin_floor` — and the offer builder is not allowed to see cost.** [`growth/offers.py`](services/api/app/growth/offers.py) never imports `economics`. It proposes the most persuasive offer the campaign's published ceiling allows; the gauntlet, which *does* see cost, decides whether the merchant can afford it. A builder that could see the floor would quietly clamp to it, and the floor would never visibly fire.

**`buyer_bounds` — the merchant refuses to oversell a mandate.** Present a mandate to `GET /growth/offers` and offers are fitted to what that buyer may actually spend. An upsell above the per-transaction cap is not blocked at checkout — **it is never made.** Pushing an agent at a purchase its principal forbade only manufactures a denial.

<br/>
<br/>

---

## 🏛️ System design

### Architecture

Two symmetric halves over one shared spine. The buy side bounds what an agent may spend; the sell side bounds what the merchant may give away. Neither can reach the payment service without passing its own engine first.

```mermaid
flowchart TB
    A["AI buyer agent<br/>MCP client · or plain HTTP"]

    subgraph S[" Sell side · what a merchant may give away "]
        direction LR
        S1["offer builder<br/>cannot see cost"] --> S2["margin engine<br/>9 checks · pure"] --> S3["campaign<br/>discount ledger"]
    end

    subgraph B[" Buy side · what an agent may spend "]
        direction LR
        B1["catalog<br/>ACP feed · search"] --> B2["mandate<br/>budget ledger"] --> B3["policy engine<br/>9 checks · pure"]
    end

    P["payments<br/>orders · HMAC-verified webhooks"]
    R["Razorpay · test mode"]
    L["audit chain<br/>SHA-256 · append-only"]
    D["Control room · live via SSE"]

    A -->|asks for offers| S1
    A -->|discovers| B1
    S3 -->|offer_id| B3
    B3 -->|auto_approve only| P
    P <--> R
    S2 -.-> L
    B3 -.-> L
    P -.-> L
    L --> D
```

The one invariant worth stating on its own: **`growth/offers.py` never imports `growth/economics.py`.** The builder proposes the most persuasive offer the campaign's published ceiling allows; only the engine sees cost and decides what the merchant can afford. If the builder could see the floor it would quietly clamp to it, and the floor would never visibly fire. A test reads the engine's own source and fails if it ever reaches for a database or an HTTP client.

<br/>

### The path of one purchase

Discovery through settlement, including the two refusals that make the demo.

```mermaid
sequenceDiagram
    autonumber
    participant A as Buyer agent
    participant G as Growth service
    participant E as Margin gauntlet
    participant P as Policy gauntlet
    participant Y as Payments
    participant R as Razorpay
    participant L as Audit chain

    A->>G: GET /catalog/search
    G-->>A: products · integer paise · typed attrs

    A->>G: GET /growth/offers (+ mandate)
    G->>E: 3 drafts · builder has no cost data
    E->>E: 9 checks · margin, budget, buyer bounds
    E-->>G: 2 published · 1 suppressed
    G->>L: offer.published × 2 · offer.suppressed
    G-->>A: offers + withheld, each with a reason

    Note over A: Declines the bundle.<br/>Asked for a mouse, no authority to buy earphones.
    A->>G: POST /growth/offers/{id}/decline
    G->>L: offer.declined · discount hold released

    A->>P: POST /intents (mandate, product, offer_id)
    P->>P: 9 checks · offer re-priced server-side
    P->>L: intent.created · policy.decision
    P-->>A: auto_approve · budget reserved

    A->>Y: POST /intents/confirm
    Y->>R: create order + payment link
    R-->>Y: order_* · plink_*
    Y-->>A: checkout_url

    R->>Y: webhook · HMAC-SHA256 over raw body
    Y->>Y: verify signature, else reject
    Y->>L: payment.webhook_verified · intent.paid
    Note over Y: Only here does money settle:<br/>mandate spend, campaign discount, stock.
```

<br/>

### State machines

An intent and an offer both hold money before they consume it, and both can end without consuming any.

**Purchase intent**

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> APPROVED: all 9 pass
    PENDING --> GATED: ≥ ₹5,000
    PENDING --> DENIED: a check fails
    GATED --> APPROVED: human approves<br/>re-runs every check
    GATED --> DENIED: human rejects
    APPROVED --> PAID: signed webhook
    APPROVED --> FAILED: card declined
    APPROVED --> EXPIRED: hold times out
    PAID --> [*]
    DENIED --> [*]
    FAILED --> [*]
    EXPIRED --> [*]
```

Budget is **reserved** at `APPROVED` and `GATED`, **settled** at `PAID`, and **released** at `FAILED`, `DENIED` and `EXPIRED`.

**Merchant offer** — the same shape, pointed the other way.

```mermaid
stateDiagram-v2
    [*] --> PUBLISHED: all 9 pass
    [*] --> GATED: discount ≥ ₹800
    [*] --> SUPPRESSED: a check fails
    GATED --> PUBLISHED: human approves<br/>re-runs every check
    GATED --> SUPPRESSED: human rejects
    PUBLISHED --> ACCEPTED: buyer takes it
    PUBLISHED --> DECLINED: buyer passes
    PUBLISHED --> EXPIRED: 15 min TTL
    ACCEPTED --> [*]
    SUPPRESSED --> [*]
    DECLINED --> [*]
    EXPIRED --> [*]
```

Discount is **reserved** at `PUBLISHED` and `GATED`, **settled** when the intent pays, and **released** at `DECLINED`, `SUPPRESSED` and `EXPIRED`.

> A suppressed offer holds **no** budget at all, which is what makes `margin_protected` a number rather than a slogan: it sums discount the gauntlet refused to reserve in the first place.

<br/>

### Data model

Nine tables. Cost price lives in its own, deliberately absent from the `Product` model and from every agent-facing route.

```mermaid
erDiagram
    PRODUCT ||--o| PRODUCT_ECONOMICS : "cost, merchant-private"
    PRODUCT ||--o{ PURCHASE_INTENT : "anchors"
    MANDATE ||--o{ PURCHASE_INTENT : "authorises"
    CAMPAIGN ||--o{ OFFER : "funds"
    OFFER ||--o| PURCHASE_INTENT : "prices"
    PURCHASE_INTENT ||--o| PAYMENT : "settles via"
    PAYMENT ||--o{ WEBHOOK_EVENT : "verified by"

    PRODUCT {
        text id PK
        int price_paise
        int stock
        json attributes
    }
    PRODUCT_ECONOMICS {
        text product_id PK
        int cost_paise "never agent-facing"
    }
    MANDATE {
        text mandate_id PK
        int per_txn_cap_paise
        int total_budget_paise
        int spent_paise "server-side only"
        int reserved_paise
    }
    CAMPAIGN {
        text campaign_id PK
        int discount_budget_paise
        int discount_spent_paise
        int discount_reserved_paise
        int floor_margin_bps
    }
    OFFER {
        text offer_id PK
        text status
        int discount_paise
        int baseline_paise "the counterfactual"
        json decision "the 9 checks"
    }
    PURCHASE_INTENT {
        text intent_id PK
        text status
        int amount_paise
        int discount_paise
        json decision "the 9 checks"
    }
    PAYMENT {
        text payment_id PK
        text rzp_order_id
        text status
    }
    AUDIT_LOG {
        int seq PK
        text prev_hash
        text hash "SHA-256 chain"
    }
```

`AUDIT_LOG` deliberately has no foreign keys. It is an append-only record of what happened, not a relation to be joined against, and SQLite triggers abort every `UPDATE` and `DELETE` against it.

<br/>

### Request layering

Every write follows the same four steps, which is why both sides can share one shape.

```
  router/           HTTP shape only. Parses, delegates, maps domain errors to codes.
     ↓              No business rules live here.
  service/          Orchestration. Opens a transaction, assembles context,
     ↓              calls the engine, writes the ledger and the audit row together.
  engine.py         Pure function. Context in, decision out. No DB, no network,
     ↓              no clock beyond a timestamp. Every check testable in isolation.
  db.py             BEGIN IMMEDIATE. Availability tests live in the SQL WHERE
                    clause, so two racing agents cannot both win.
```

The engine being pure is what makes every decision reproducible from its audit payload alone: given the same context, it returns the same nine checks with the same reasons, forever.

<br/>

---

## 💰 The ledgers

Both sides run the same three-phase accounting, for the same reason: two agents racing for the last rupee must not both win.

```
   intent approved                      offer published
         │                                     │
         ▼                                     ▼
   ╔═══════════╗                        ╔═══════════╗
   ║ RESERVED  ║  budget held           ║ RESERVED  ║  discount held
   ╚═════╤═════╝                        ╚═════╤═════╝
     ┌───┴────┐                           ┌───┴────┐
     ▼        ▼                           ▼        ▼
  SETTLED  RELEASED                    SETTLED  RELEASED
  (webhook  (declined,                 (webhook  (declined,
   verified) failed, expired)           verified) failed, expired)
```

The availability test lives in the SQL `WHERE` clause, not in application code:

```sql
UPDATE mandate
   SET reserved_paise = reserved_paise + ?
 WHERE mandate_id = ? AND revoked_at IS NULL
   AND (total_budget_paise - spent_paise - reserved_paise) >= ?
```

A failed charge never consumes budget on either side. A declined offer hands its discount back so it can fund one somebody will take.

<br/>

---

## 📜 The audit chain

Every state change across **both** sides lands in one append-only hash chain:

```
hashₙ = SHA-256( hashₙ₋₁ ‖ canonical_json(eventₙ) )
```

| Layer | Mechanism |
|:---|:---|
| **Application** | every row hashes `prev_hash + canonical_json(event)` before insert |
| **Database** | SQLite triggers physically `RAISE(ABORT)` on `UPDATE` and `DELETE` |
| **Verification** | `GET /audit/verify` walks genesis → head and reports the exact broken sequence |
| **Streaming** | Server-Sent Events push each new block to the dashboard live |

```bash
curl -s http://127.0.0.1:8000/audit/verify
```

Buy-side and sell-side events interleave on the same chain — `offer.published`, `offer.suppressed`, `intent.created`, `policy.decision`, `offer.accepted`, `payment.webhook_verified`, `intent.paid`. One story, one order, one hash.

<br/>

---

## 📈 Revenue, measured against a counterfactual

Uplift is not asserted. When an offer is built it records `baseline_paise` — what that buyer would have paid with no offer at all, one anchor at list price. Uplift is settled revenue minus the sum of those baselines, over settled orders only.

Two consequences, both deliberate:

- **A published offer nobody took is worth nothing.** Impressions are not revenue.
- **An accepted offer whose payment failed is worth nothing either.** Only a signature-verified settlement counts.

And the mirror number, which exists only because refused offers are *recorded* rather than dropped:

> **`margin_protected`** — the discount the gauntlet declined to give away. It is the clearest single figure for what the guardrails are worth to the merchant, and it sits on the dashboard beside the revenue the offers earned.

<br/>

---

## 🤝 The buyer agent is a fiduciary

The buyer agent asks for offers and then judges them **on its principal's behalf**, which mostly means turning them down:

| Offer | Verdict | Why |
|:---|:---|:---|
| **Bundle** | declined | *"it adds Kestrel Wired Earphones to the order. The saving is real, but I was asked for a wireless mouse and I have no authority to buy something else with my principal's money."* |
| **Volume** | declined | *"it commits to 3 units when one was wanted."* |
| **Upgrade** | **accepted** | *"same job, better product: ₹281.07 more, with the merchant funding ₹118.93 of the difference."* |

An agent that takes every upsell is not representing anybody. An upgrade is accepted only when the premium stays modest, the merchant is genuinely funding the step, and any price ceiling in the original instruction still holds — *"a better product is not worth ignoring the limit I was given."*

That is why the revenue is defensible: it comes from a buyer that said no twice first.

<br/>

---

## 🔌 MCP server — 8 tools

A thin adapter over the merchant's **public HTTP API**, not an in-process shortcut, which is how a merchant would actually ship it.

```json
{
  "mcpServers": {
    "vyapaar": {
      "command": "path/to/.venv/Scripts/python.exe",
      "args": ["-m", "app.mcp_server"],
      "cwd": "path/to/Vyapaar/services/api",
      "env": { "VYAPAAR_API_URL": "http://127.0.0.1:8000" }
    }
  }
}
```

| Tool | What it does |
|:---|:---|
| `get_merchant_info` | How to buy here, for an agent arriving cold |
| `search_catalog` | Natural language plus a hard price ceiling. Hybrid BM25 + vector |
| `get_product` | One product's full typed record |
| `check_mandate` | Remaining budget and caps, so an agent can bound its search *before* shopping |
| **`get_offers`** | **What the merchant will offer — fitted to your mandate if you present one** |
| `create_purchase_intent` | Runs all nine guardrails. Accepts an `offer_id` |
| `confirm_purchase` | Opens a Razorpay order and payment link. Refuses anything not `APPROVED` |
| `check_intent` | Did it actually settle, or is it still awaiting the webhook? |

**Try it:** *"Using the vyapaar tools, buy me a wireless mouse under ₹2,000. Check for offers first and tell me why you took or refused each one."*

<br/>

---

## 💳 Payments: real rails, test mode

Razorpay **test mode only** — [`config.py`](services/api/app/config.py) refuses any key that does not start with `rzp_test_`. This cannot be pointed at real money.

<table>
<tr><td width="50%">

**With no keys (default)**

A built-in simulator that mints Razorpay-shaped ids, serves a local checkout page, and **signs its webhooks with HMAC-SHA256** — the same scheme Razorpay uses. The verification path is genuinely exercised; the simulator cannot skip the check it is demonstrating.

</td><td width="50%">

**With Razorpay test keys**

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`; the simulator disables itself. Real `order_*` and `plink_*` ids then appear in your Razorpay test dashboard. Expose the webhook with `ngrok http 8000`.

</td></tr>
</table>

> **Settlement rule.** An intent becomes `PAID` **only** inside the webhook handler, after `HMAC-SHA256(raw_body)` matches `X-Razorpay-Signature`. A client claiming "I paid, honest" gets a rejected-webhook audit row and nothing else.

<br/>

---

## 🚀 Quickstart

**Prerequisites:** Python 3.12+, Node 20+. **No API keys needed** — the simulator and the offline planner run the whole demo.

**Terminal 1 — API**

```bash
python -m venv .venv && .venv\Scripts\activate
pip install -r services/api/requirements-dev.txt
cd services/api && python -m uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — web**

```bash
npm install && npm run dev
```

| URL | What |
|:---|:---|
| `http://localhost:3000` | Landing page — the scroll-driven walkthrough |
| `http://localhost:3000/dashboard` | **Control room** — start here for a demo |
| `http://127.0.0.1:8000/docs` | Interactive API docs (47 endpoints) |

Or skip all of it and use the deployed instance:

| URL | What |
|:---|:---|
| [vyapaar-web.vercel.app/dashboard](https://vyapaar-web.vercel.app/dashboard) | **Live control room** |
| [vyapaar-api.onrender.com/docs](https://vyapaar-api.onrender.com/docs) | Live API docs |
| [vyapaar-api.onrender.com/audit/verify](https://vyapaar-api.onrender.com/audit/verify) | Verify the live audit chain |

Then follow **[docs/DEMO_FLOW.md](docs/DEMO_FLOW.md)**, which walks the whole product in about six minutes.

To put it somewhere a judge can click instead, see **[docs/DEPLOY.md](docs/DEPLOY.md)** — the API ships as a container and the web app goes to Vercel.

<br/>

---

## 🖥️ The control room

| Section | What it shows |
|:---|:---|
| **Overview** | Both sides at once — the view to leave open while the agent works |
| **Buyer agent** | Issue a mandate, type a goal, watch the step-by-step transcript |
| **Purchase intents** | Every intent with all nine checks and the reason each passed or failed |
| **Mandates** | Budget meters: spent, held, remaining, and the signed scope |
| **Revenue & campaign** | The **offer studio** (pick a product and an authority level, watch the shelf change), the campaign's discount ledger, and revenue attribution |
| **Offer ledger** | Every offer proposed — published, gated or suppressed — with its margin gauntlet, and the approve/reject control for deep discounts |
| **Audit trail** | Live SSE hash chain with a verification badge |
| **Scenarios** | 11 one-click scripted runs against the real services |

<br/>

---

## 🧪 Test suite

```bash
cd services/api && python -m pytest -q
```

**178 tests**, all passing.

| File | Tests | Covers |
|:---|---:|:---|
| `test_growth_flow.py` | 39 | quote → accept → settle → attribute, the discount ledger, the fiduciary agent |
| `test_growth_engine.py` | 34 | every sell-side check, plus a guard that the engine never reaches for a database |
| `test_end_to_end.py` | 27 | full agent runs, re-planning, the HITL gate |
| `test_policy_engine.py` | 26 | every buy-side check in isolation, ordering, short-circuit semantics |
| `test_mandate.py` | 20 | signing and four flavours of tamper rejection |
| `test_payments.py` | 17 | HMAC over raw bytes, forged signatures, reserve/settle/release |
| `test_audit.py` | 13 | hash continuity, tamper detection, broken-at-seq reporting |

A few worth naming:

- `test_cost_price_never_appears_in_an_agent_facing_offer` — serialises the response and asserts the merchant's cost is absent from it.
- `test_the_engine_never_touches_the_database` — reads the engine's own source and fails if it imports `db`, `sqlite3`, `requests` or `httpx`.
- `test_a_human_cannot_waive_the_margin_floor` — approves a gated offer whose economics have since gone bad, and asserts it is suppressed anyway.
- `test_a_failed_payment_returns_the_discount` — a charge that never lands must not consume campaign budget.
- `test_an_offer_cannot_be_repriced_after_publication` — the merchant may make an offer; it may not change one already accepted.

<br/>

---

## 🗂️ Layout

```
Vyapaar/
├── apps/web/                       Next.js 16 · React 19 · Tailwind
│   ├── app/
│   │   ├── page.tsx                Landing (GSAP scroll narrative)
│   │   ├── dashboard/page.tsx      Control room
│   │   └── icon.svg                The [₹] mark
│   ├── components/
│   │   ├── growth/                 Offer studio, ledger, campaign, revenue
│   │   ├── landing/                Hero, bento, guardrail + audit scenes
│   │   └── ui.tsx                  Panel, Badge, Ring, CountUp, SegmentBar
│   └── lib/api.ts                  Zod-validated API client
│
├── services/api/app/               FastAPI · Python 3.12
│   ├── catalog/                    ACP-style feed, hybrid BM25 + vector search
│   ├── mandate/                    JWT minting + budget ledger
│   ├── policy/engine.py            Buy-side gauntlet  (pure function)
│   ├── growth/                     ── the merchant's side ──
│   │   ├── engine.py               Sell-side gauntlet (pure function)
│   │   ├── offers.py               Bundle / volume / upgrade builders
│   │   ├── economics.py            Merchant-private cost, never agent-facing
│   │   ├── campaigns.py            Campaign store + discount ledger
│   │   ├── attribution.py          Uplift against a recorded counterfactual
│   │   └── service.py              Propose → judge → publish → account → audit
│   ├── payments/                   Razorpay gateway + HMAC simulator
│   ├── audit/                      Hash chain + SSE broadcaster
│   ├── agent/                      Buyer agent (fiduciary offer policy)
│   └── mcp_server.py               8 MCP tools over the public HTTP API
│
├── packages/shared-types/          Zod mirrors of the Pydantic models
├── seed/                           33 products · 11 scenarios
├── Dockerfile                      API image; preserves the repo's path depth
├── render.yaml                     Render blueprint for the API
└── docs/
    ├── DEMO_FLOW.md                How to run and narrate the whole product
    ├── PROJECT.md                  Objectives, features, obstacles hit
    └── DEPLOY.md                   Render + Vercel, in the order that works
```

<br/>

---

## ⚙️ Configuration

Every value has a working default — see [`.env.example`](.env.example).

| Variable | Default | Notes |
|:---|:---|:---|
| `MANDATE_JWT_SECRET` | dev default | **Change it.** `/health` warns while it is unset |
| `HITL_THRESHOLD_PAISE` | `500000` | ₹5,000. Purchases at or above this need a human |
| `RAZORPAY_KEY_ID` / `_SECRET` | *(empty)* | Empty → simulator. Must be `rzp_test_*` |
| `PAYMENTS_MODE` | `auto` | `auto` uses real test mode when keys exist |
| `LLM_PROVIDER` | `auto` | First provider with a key, else a deterministic planner |
| `EMBEDDINGS_BACKEND` | `hashing` | Deterministic, zero-dep. `sentence-transformers` for dense vectors |

Campaign bounds — discount budget, margin floor, human gate — are runtime state rather than config. Set them at `POST /growth/campaigns` or from the control room.

<br/>

---

## 📐 Scope and design decisions

| | |
|:---|:---|
| **Sovereign fiat, not crypto** | No x402, no MPP. Settles in INR through Razorpay, on the rails Indian merchants already use |
| **UAP's pattern, not its wire format** | UAP is not live yet. One-time human consent and per-merchant limits are implemented as a signed mandate, so nothing here depends on an unreleased protocol. When it ships, `mandate/` is the only module that changes |
| **Test mode, enforced in code** | [`config.py`](services/api/app/config.py) refuses any key that is not `rzp_test_*`. The safety property is structural, not a promise |
| **A protocol layer, not a chat widget** | Conversational checkout inside a merchant's app already exists. This is the half that does not: the agent that has never heard of you |

Two engineering decisions keep the whole demo reproducible on any machine, with no network and no keys. **SQLite** instead of Postgres + pgvector: vectors stored as blobs and compared with cosine in numpy, behaviourally identical across a 33-item catalog, and the append-only guarantee ends up *stronger* because database triggers enforce it. A **deterministic hashing embedder** instead of `sentence-transformers`: no 2 GB download, identical vectors on every machine, and one env var switches to `all-MiniLM-L6-v2` with no other change.

<br/>

---

<div align="center">

### Built for the Razorpay buildathon · Track 01

**Discover → Offer → Mandate → Guardrails → Payment → Audit**

*Both sides bounded. Every refusal recorded. One chain.*

<br/>

**MIT licensed**

</div>
