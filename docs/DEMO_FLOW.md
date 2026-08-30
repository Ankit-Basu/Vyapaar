# Demo flow

How to run Vyapaar end to end and narrate it. About **six minutes** at a comfortable pace, or **three** if you skip section 5.

Everything below runs against the real services. Nothing is mocked, and no step reaches around a guardrail.

---

## Before you start

**Two terminals.**

```bash
cd services/api && python -m uvicorn app.main:app --reload --port 8000
```

```bash
npm run dev
```

**Then, in this order:**

1. Open `http://localhost:3000/dashboard`.
2. Click **Reset demo** in the rail. This wipes the database, re-seeds 33 products, re-derives unit economics and opens a fresh campaign. The audit trail starts empty, which matters — the chain is more convincing when the audience watches it fill.
3. Confirm the header reads **chain intact** and the top strip shows **33 products**.

> **Tip for recording.** Keep the browser at 1440×900 or wider. Below `lg` the rail collapses above the content and the two-column panels stack, which reads worse on video.

---

## 1 · The shape of the thing (30s)

Stay on **Overview**. Do not click anything yet.

> "This is one merchant on Razorpay test mode. The left column is the buy side — an outside AI agent shopping under a mandate. The right column is the sell side — the merchant's own growth agent. Both are bounded by their own guardrails, and everything either one does lands on the same hash chain at the bottom."

Point at the top strip: **payments mode**, **planner**, **human gate ₹5,000**, **33 products**.

---

## 2 · An agent buys something (60s)

In **Buyer agent**:

1. Click **Grant a mandate — ₹3,000 per purchase, ₹10,000 total**.

   > "A human just granted consent. It is a signed JWT carrying scope: a per-transaction cap, a total budget, and an allow-list of categories. What it does *not* carry is how much has been spent — that lives server-side, so a holder who decodes and edits their own token changes nothing."

2. Type `buy a wireless mouse` and run it.

3. Walk the transcript as it appears:

   | Step | What to say |
   |:---|:---|
   | `search` → `search_results` | "It searches the machine-readable catalog. Every hit carries a rationale." |
   | `select` | "It picks the cheapest match and states why." |
   | `consider_offers` | **Stop here.** This is the hinge — see section 3. |
   | `purchase_intent` | "Nine guardrails, each with a reason." |
   | `paid` | "Settled — but only after a signature-verified webhook." |

4. Open **Purchase intents** and expand the intent. Every check is listed in order with its reason.

   > "Check 4 is the one worth noticing. The intent API does not accept an amount at all — you send a product id and a quantity, and the server prices it. There is no field for an agent to lie in."

---

## 3 · The merchant sells back (90s) — *the part nobody else has*

Go to **Revenue & campaign**. The **offer studio** is the whole sell-side argument in one panel.

### 3a · Anonymous

Leave the authority set to **Anonymous**, product on **Aurora Wireless Optical Mouse**, and click **Ask the merchant for offers**.

You get two published offers and one withheld:

- **bundle** — add the earphones, save ₹171
- **upgrade** — step up to the vertical mouse
- **withheld · `margin_floor`** — the volume tier. *"After ₹467.64 off, this offer earns 5.06% margin, below the campaign floor of 8.00%. Growing revenue by selling at a loss is not growth."*

> "The offer builder proposed all three. It is not allowed to see cost price — that module never imports it. The margin gauntlet, which does see cost, refused one of them. That is why the floor is a real check rather than a formality."

### 3b · Tight mandate — the beat to slow down on

Click **Tight mandate** (₹1,500 per purchase, electronics only) and ask again.

The shelf changes. The badge flips to **fitted to mandate**, and the bundle is now withheld on `buyer_bounds`:

> *"At ₹1,727.18 this offer is above the buyer's per-transaction cap of ₹1,500.00. The merchant will not push an agent at a purchase its principal has forbidden."*

> "Same product, same campaign, different buyer. The merchant read the mandate and refused to make an offer this buyer is not allowed to accept. Note what did *not* happen: this was not blocked at checkout. The offer was never made. Pushing an agent at a purchase its owner forbade only manufactures a denial and wastes a round trip for both sides."

### 3c · Back to the transcript

Return to **Buyer agent** and re-read the `consider_offers` step from section 2:

> *"Declining the bundle: it adds Kestrel Wired Earphones to the order. The saving is real, but I was asked for a wireless mouse and I have no authority to buy something else with my principal's money."*
>
> *"Taking the upgrade: same job, better product — ₹281.07 more, with the merchant funding ₹118.93 of the difference."*

> "The buyer agent is a fiduciary, not a shopper. It turned down the bundle and the volume tier because they change *what* it was asked to buy. It took the upgrade because that is the same job done better, with the merchant paying part of the step. The uplift on this screen came from a buyer that said no twice first."

---

## 4 · What it was worth (45s)

Point at the **Revenue** panel:

| Figure | What to say |
|:---|:---|
| **Revenue uplift ₹281.07 · +21.6%** | "Measured against a counterfactual the offer recorded when it was built — what this buyer would have paid with no offer at all." |
| **AOV with / without** | "The gap is the whole point." |
| **Attach rate** | "Share of settled orders that took an offer." |
| **Margin protected** | "The discount the gauntlet refused to give away. This number only exists because refused offers are recorded rather than dropped." |
| **Offers proposed** bar | "Accepted, live, gated, suppressed — where every proposal actually ended up." |

Then the **Campaign** panel below:

> "A campaign is the merchant's own mandate: an envelope of discount with a margin floor under it and a human gate above it. Discount is *held* when an offer publishes and only *given away* when the payment clears — the same three-phase ledger the buyer's budget uses. A charge that fails never costs the merchant a rupee of campaign budget."

Click **Rebalance** to show the orchestrator:

> "Deterministic and explainable. Each move names the product, the action and the observation that drove it — promote what is overstocked and carries margin, withdraw what is thin on either. The whole pass is one row on the audit chain."

---

## 5 · Failures, handled (60s) — *optional, pick two*

Go to **Scenarios**. Eleven one-click runs against the real services.

| Scenario | The beat |
|:---|:---|
| **Budget exhausted** | Denied on `budget_remaining`, which names the exact shortfall, then the agent re-searches and buys a cheaper model. Recovery, not a crash. |
| **Card declined** | Approved → checkout → declined → intent `FAILED` → budget hold **released**. A failed charge never consumes budget. |
| **Tampered mandate** | JWT edited to raise the cap to ₹999,999. `mandate_valid` fails on signature before anything else runs. |
| **Deep discount gate** | A bundle on the ₹12,499 chair exceeds the review threshold. Not suppressed — **held**, with its discount reserved so a second offer cannot overcommit while a person decides. |
| **Margin floor holds** | Cost is driven up until any discount breaches the floor. The builder still proposes; the gauntlet still refuses. |

For the gated offer, go to **Offer ledger**, expand it, and click **Approve the discount**:

> "Approving re-runs every *other* guardrail against current state first. A human waives the depth of the discount. Nobody waives the margin floor — there is a test that proves it."

---

## 6 · The receipt (30s)

Go to **Audit trail**.

> "One chain, both sides. `offer.published`, `offer.suppressed`, `intent.created`, `policy.decision`, `offer.accepted`, `payment.webhook_verified`, `intent.paid` — interleaved in the order they actually happened."

Point at the **chain intact** badge, then run:

```bash
curl -s http://127.0.0.1:8000/audit/verify
```

> "Each row hashes the previous hash plus its own canonical JSON. And it is append-only at the database level — SQLite triggers physically abort any UPDATE or DELETE, not merely a convention in application code."

If you want the strongest version of this, edit a historical row directly in SQLite before recording and let `/audit/verify` report the exact broken sequence number.

---

## Closing line

> "Both sides of the counter are bounded. The buyer cannot exceed what a human signed. The merchant cannot lie about a saving, sell below its floor, or push an agent past its owner's limits. Every refusal on either side is recorded, and every rupee is on one chain."

---

## Quick reference

**One-click scenarios**

| Buy side | Sell side |
|:---|:---|
| `happy_path` | `offer_accepted` |
| `budget_exceeded` | `offer_refused_by_mandate` |
| `human_gate` | `margin_floor_holds` |
| `category_blocked` | `deep_discount_gate` |
| `out_of_stock` | |
| `payment_failure` | |
| `forged_mandate` | |

**Useful endpoints during a demo**

```bash
curl -s http://127.0.0.1:8000/growth/metrics          # revenue attribution
curl -s http://127.0.0.1:8000/growth/campaigns        # the discount ledger
curl -s http://127.0.0.1:8000/growth/economics        # merchant-private costs
curl -s http://127.0.0.1:8000/audit/verify            # chain integrity
curl -s "http://127.0.0.1:8000/growth/offers?product_id=prod_elec_001"
```

**If something looks wrong**

| Symptom | Fix |
|:---|:---|
| Panels show "Cannot reach the API" | The API is not on `:8000`. Check terminal 1. |
| Revenue shows all zeros | Nothing has settled yet. Run the `offer_accepted` scenario. |
| No offers on a product | It may be out of stock — an out-of-stock anchor gets no offers by design. Or the campaign is paused. |
| Audit chain says invalid | Something edited a historical row. That is the feature working; **Reset demo** clears it. |
