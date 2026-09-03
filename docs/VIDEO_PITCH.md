# Demo video — script and shot list

A **3:30** cut, shot in order, with everything you say written out. There is a 90-second version at the bottom.

> **The one idea to land.** Everyone else is building one half of Track 01 — either a safe agent buyer or an upsell bot. Vyapaar is the only one where *both* sides of the counter are bounded by the same machinery, and the single most memorable moment is the merchant **refusing to make an offer** because the buyer's mandate would not allow it. Make sure that lands. Everything else is support.


---

## Does this cover the brief?

Track 01 asks for two things and sets one bar. Every line of the brief, and the
beat that answers it:

| The brief says | Where the video answers it |
|:---|:---|
| *"Grow the merchant's revenue"* | **1:10–2:40** — the offer studio, then the Revenue panel: uplift measured against a recorded counterfactual |
| *"…make them sellable to AI buyers"* | **0:35–1:10** — an outside agent discovers, prices and buys end to end |
| *"on Razorpay test-mode APIs"* | **0:35–1:10** — a real `order_*` opens; the config refuses any key that is not `rzp_test_` |
| Example: *agent-readable catalog* | **0:35** — the agent searches a machine-readable feed; integer paise, typed attributes, no prose to parse |
| Example: *upsell & cross-sell agent* | **1:10–2:10** — bundle, volume tier and upgrade, each with a stated rationale |
| Example: *campaign orchestrator* | **2:10–2:40** — the campaign meter, its three bounds, and **Rebalance** |
| **The bar:** *every money action explainable* | Every check read out loud with its reason, on both sides |
| **The bar:** *bounded* | The mandate caps the buyer; the campaign caps the merchant |
| **The bar:** *gated* | ₹5,000 human gate on a purchase; ₹800 human gate on a discount |
| **The bar:** *show the audit trail* | **3:10–3:30** — one chain, both sides, then `/audit/verify` in the terminal |
| **The bar:** *one failure handled gracefully* | **2:40–3:10** — **Card declined**: intent FAILED, budget hold released |

The one example direction deliberately **not** built is *conversational in-app
checkout* — Razorpay's own pilots already do that, and it is the half of the
problem that only helps people who already opened the merchant's app. Say so if
asked; it is a choice, not a gap.

---

## Before you record

```bash
# terminal 1
cd services/api && python -m uvicorn app.main:app --port 8000

# terminal 2
npm run dev
```

**Record against localhost, not the deployed site.** The live URL is real and you
should show it — but Render's free instance cold-starts in about 30 seconds and
adds latency to every click after that, which makes a good product look sluggish
on camera. Film locally, and spend five seconds proving it is deployed (see the
cold open).

- [ ] Browser at **1440×900 or wider** (below `lg` the layout stacks and reads badly).
- [ ] **Reset demo** in the dashboard rail. Chain must be empty; header must say **chain intact**.
- [ ] Run through once without recording. The offer studio needs a real round-trip and you want to know its timing.
- [ ] Close every other tab. The tab strip is on camera and the `[₹]` favicon is a nice touch.
- [ ] **Leave `PAYMENTS_MODE=simulated` for the recording.** With real keys the simulator disables itself and settlement waits on a webhook Razorpay cannot reach on `localhost` — intents would sit at `AWAITING_PAYMENT` and the demo would stall. The simulator signs its webhooks with the same HMAC-SHA256 the real one does, so the verification path is genuinely exercised either way.
- [ ] *Optional, for a separate 10-second cut:* with test keys set and `PAYMENTS_MODE=live`, create one order and show it land in the Razorpay test dashboard. Real `order_*` ids on camera are worth more than any slide. Then switch back to `simulated` before recording the main flow.

---

## Shot list

### 0:00 – 0:20 · Cold open on the landing page

**Screen:** `localhost:3000`. Scroll slowly from the hero through the stat strip.

> **Optional 5-second proof, worth including.** Before you cut to localhost, have
> `https://vyapaar-web.vercel.app/dashboard` open in a second tab and show it for
> a beat: *"this is running live, and the link is in the README."* Then switch to
> localhost for the rest so nothing lags. Judges discount things they cannot
> reach; five seconds buys that off cheaply.

> "Razorpay's own pilots already put conversational checkout inside a merchant's app. Track 01 asks for something harder — make a merchant sellable to AI buyers, *and* grow that merchant's revenue.
>
> Most answers pick one. This is Vyapaar, and it does both — because they turn out to be the same problem pointed in opposite directions."

**Land on the stat strip:** `9 + 9 guardrails · 178 tests · SHA-256 · 0 rupees at risk`.

---

### 0:20 – 0:35 · The thesis

**Screen:** keep scrolling to the **Growth** section — the four sell-side cards.

> "A discount is a money action in exactly the same sense a purchase is. So it gets the same treatment: an ordered gauntlet, a budget ledger, a human gate, and a row on the same audit chain.
>
> Nine checks bound what a buyer may spend. Nine more bound what the merchant may give away."

*Cut to the dashboard. Don't linger on the landing page — the product is the control room.*

---

### 0:35 – 1:10 · An agent buys something

**Screen:** dashboard **Overview**.

> "One merchant on Razorpay test mode. Left column is the buy side. Right column is the merchant's own growth agent."

**Click:** *Grant a mandate — ₹3,000 per purchase, ₹10,000 total.*

> "A human just granted consent — a signed JWT carrying a per-transaction cap, a total budget and an allow-list of categories. What it does *not* carry is how much has been spent. That lives server-side, so a holder who decodes and edits their own token changes nothing."

**Type:** `buy a wireless mouse` → **Run**.

*Let the transcript stream. Do not narrate every line.*

> "It searches the machine-readable catalog, picks the cheapest match, and states why."

**Pause on `purchase_intent`.** Expand the intent in **Purchase intents**.

> "Nine guardrails, each with a reason. And notice check four — the intent API does not *accept* an amount at all. You send a product id and a quantity, and the server prices it. There is no field for an agent to lie in."

---

### 1:10 – 2:10 · The part nobody else has

**Screen:** **Revenue & campaign** → the offer studio.

**Click:** *Ask the merchant for offers* (leave authority on **Anonymous**).

> "Now the merchant sells back. Its growth agent proposed three offers — a bundle, an upgrade, and a volume tier."

**Point at the withheld card.**

> "And its own guardrails refused one of them: *after ₹467 off, this offer earns 5% margin, below the campaign floor of 8%. Growing revenue by selling at a loss is not growth.*
>
> The offer builder isn't allowed to see cost price — that module never imports it. The margin gauntlet, which does, refuses what the merchant can't afford. That's why the floor is a real check and not a formality."

**Now the money shot. Click *Tight mandate*, then *Ask the merchant for offers* again.**

*Let the shelf visibly change. Give it a beat of silence.*

> "Same product. Same campaign. Different buyer.
>
> This agent carries a mandate capped at ₹1,500 a purchase — and the bundle is gone. *At ₹1,727 this offer is above the buyer's per-transaction cap. The merchant will not push an agent at a purchase its principal has forbidden.*
>
> Notice what did **not** happen. This wasn't blocked at checkout. The offer was **never made.** The merchant read the mandate and fitted its merchandising to what this buyer is actually allowed to spend."

**Cut back to the buyer agent transcript, `consider_offers` step.**

> "And the buyer agent isn't a shopper — it's a fiduciary. It *declined* the bundle: *the saving is real, but I was asked for a wireless mouse and I have no authority to buy something else with my principal's money.*
>
> It took the upgrade — same job, better product, with the merchant funding part of the step. The revenue on this screen came from a buyer that said no twice first."

---

### 2:10 – 2:40 · What it was worth

**Screen:** the **Revenue** panel.

> "Revenue uplift: ₹281 — 21.6%. And that's measured, not asserted: every offer records what this buyer *would* have paid with no offer at all, and uplift is the difference over settled orders only. A published offer nobody took is worth zero. So is an accepted offer whose payment failed."

**Point at margin protected.**

> "And the mirror number — margin protected. That's discount the gauntlet refused to give away. It only exists because refused offers are recorded rather than dropped. Growth and the guardrails, priced side by side."

**Scroll to the campaign meter.**

> "The campaign is the merchant's own mandate: an envelope of discount with a margin floor under it and a human gate above. Discount is *held* when an offer publishes and only *given away* once the payment clears — the same ledger the buyer's budget uses."

---

### 2:40 – 3:10 · One failure, handled

**Screen:** **Scenarios** → run **Card declined**.

> "One failure, end to end. Approved, checkout opened, card declined — intent goes FAILED and the budget hold is released. A charge that never lands never consumes budget on either side."

*Optional if you have room — run **Deep discount gate**, go to **Offer ledger**, expand it and click **Approve the discount**.*

> "And the sell side is gated too. A discount past the review threshold isn't suppressed — it's held, with the money reserved so a second offer can't overcommit while a person decides. Approving re-runs every *other* guardrail first. A human waives the depth of the discount. Nobody waives the margin floor — there's a test that proves it."

---

### 3:10 – 3:30 · The receipt, and out

**Screen:** **Audit trail**.

> "One chain, both sides, interleaved in the order it actually happened. Offer published, offer suppressed, intent created, policy decision, payment webhook verified, intent paid."

**Terminal:**

```bash
curl -s http://127.0.0.1:8000/audit/verify
```

*If you kept the live tab open, this is a nice place to run the same command
against it — same output, from a URL anyone can hit:*

```bash
curl -s https://vyapaar-api.onrender.com/audit/verify
```

> "Each row hashes the previous hash plus its own canonical JSON — and it's append-only at the *database* level. SQLite triggers physically abort any UPDATE or DELETE. Not a convention in application code."

**Final line, over the dashboard:**

> "Both sides of the counter are bounded. The buyer can't exceed what a human signed. The merchant can't lie about a saving, sell below its floor, or push an agent past its owner's limits.
>
> Every refusal on either side is recorded. Every rupee is on one chain."

---

## The 90-second cut

If the submission caps you at 90 seconds, drop 0:00–0:35 and 2:40–3:10 entirely. Keep:

| Time | Beat |
|:---|:---|
| 0:00 – 0:10 | One line of framing over the dashboard: *"Track 01 asks for two things. Most answers pick one."* |
| 0:10 – 0:35 | Mandate granted → agent buys → nine checks with reasons |
| 0:35 – 1:15 | **The offer studio. Anonymous, then tight mandate. The shelf changes.** Give this the most time. |
| 1:15 – 1:30 | Revenue uplift + margin protected, then the audit chain, then the closing line |

---

## Delivery notes

**Do**

- **Let the tight-mandate moment breathe.** A full second of silence after the shelf changes. It is the only genuinely novel thing on screen and people need a beat to register it.
- **Read the refusal messages out loud, verbatim.** They are the product. *"Growing revenue by selling at a loss is not growth"* does more work than any architecture diagram.
- Say **"nine and nine"** at least twice. It is the most compressible version of the whole idea.
- Show the terminal at least once. It proves the UI isn't a mockup.

**Don't**

- Don't narrate the architecture diagram. Judges have read a hundred. Show the running product.
- Don't apologise for test mode. Test mode is a *feature* — say "the config refuses any key that isn't `rzp_test_`" and move on.
- Don't scroll the landing page for more than 20 seconds. It is beautiful and it is not the product.
- Don't explain the tech stack. If they want it, it's in the README.
- Don't say "as you can see". Just show it.

**If something breaks on camera**

Keep going and narrate it. *"That's the guardrail doing its job"* is true surprisingly often. A live failure that gets explained is more convincing than a clean take.

---

## Anticipated judge questions

| Question | Answer |
|:---|:---|
| *"Isn't the upsell just a bigger cart?"* | No — uplift is measured against a counterfactual recorded at offer time, over settled orders only. A published offer nobody took is worth zero. |
| *"Could the merchant fake the discount?"* | `offer_integrity` re-prices every offer against the live catalog before publication. An inflated "was" price doesn't reconcile, so the offer is never made. |
| *"Could the agent overspend?"* | It can't even name a price — the intent API has no amount field. And the budget test is in the SQL `WHERE` clause, so two agents racing for the last rupee can't both win. |
| *"What if the buyer's LLM is jailbroken?"* | The buyer agent is treated as untrusted. It has no path to the payment service that doesn't pass `POST /intents` first, and the policy engine is a pure function that never sees a prompt. |
| *"Is the audit chain real, or just hashes in a table?"* | Both — and the database enforces it. SQLite triggers abort UPDATE and DELETE on the audit table. Edit a row directly and `/audit/verify` names the exact sequence number where the chain breaks. |
| *"Is it actually deployed?"* | Yes — `vyapaar-web.vercel.app`, API on Render, both on free tiers. The container preserves the repo's path depth because `config.py` resolves the root as `parents[3]`; flatten it and the catalog seed goes missing at boot. |
| *"Why SQLite?"* | So it reproduces on your machine with no cold start and no keys. The schema is plain SQL you can read, and the append-only guarantee is stronger than it would be in an ORM. |
