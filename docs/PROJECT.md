# Vyapaar — objectives, features, and what went wrong on the way

---

## 1 · Project objectives

### The brief

Razorpay Track 01 asks for an agent that either **grows a merchant's revenue** on test-mode APIs, **or** makes a merchant **transactable by an AI buyer end to end**. The bar: *every money action explainable, bounded and gated; show the audit trail and one failure handled gracefully.*

### What we set out to build

**O1 · Make an ordinary merchant transactable by an agent that has never heard of it.**
No SDK, no partnership, no pre-registration. An agent arrives cold at an HTTP endpoint, learns what is sold and what the rules are, proves it holds a human's consent, and pays on real banking rails.

**O2 · Grow that merchant's revenue — without the growth being a trick.**
Upsell and cross-sell aimed at a machine buyer, not a human one. No urgency banners, no anchoring, no manufactured savings. If a merchant wants an agent to accept an offer, it has to prove the offer is worth taking in numbers the agent can verify.

**O3 · Bound both sides with the same machinery.**
The insight the whole project rests on: **a discount is a money action in exactly the same sense a purchase is.** If a buyer's spending needs an ordered gauntlet, a budget ledger and a human gate, then so does a merchant's discounting. Build one shape and point it both ways.

**O4 · Make every refusal legible.**
An explanation an operator can read, not an error code. A denial should say what was tried, which bound it crossed, and by how much. A refusal that is not recorded may as well not have happened.

**O5 · Be checkable, not just claimable.**
Every headline number in the UI should be derivable from the repo. Pure-function engines so each check is testable in isolation; a counterfactual recorded at offer time so uplift is measured rather than asserted; an audit chain the database itself refuses to let you edit.

### Non-objectives

We deliberately did **not** build: crypto rails (x402, MPP), an implementation of NPCI's unreleased UAP, a chat widget inside a merchant app, or anything that touches real money. Test mode is enforced in config — `rzp_live_*` keys are refused at load.

---

## 2 · Features

### Buy side — making the merchant transactable

| Feature | What it is |
|:---|:---|
| **Agent-readable catalog** | ACP-style feed at `GET /catalog/feed`. Stable ids, integer paise, typed attributes, explicit availability. No prose an agent has to parse to get a price. |
| **Hybrid search** | BM25 + cosine vector similarity, with a hard price ceiling applied *before* ranking. Every hit carries a `rationale` explaining why it matched. |
| **Signed mandates** | AP2-pattern HMAC-SHA256 JWT encoding scope: per-transaction cap, total budget, allowed categories, expiry. Scope is in the token; **spend is not** — it lives server-side, so editing your own token changes nothing. |
| **Nine-check guardrail gauntlet** | Ordered, deterministic, pure-function. First failure short-circuits; the rest are recorded as `skipped`, never dropped. |
| **Budget ledger** | reserve → settle \| release, with the availability test in the SQL `WHERE` clause so two agents cannot both spend the last rupee. |
| **Human-in-the-loop gate** | Purchases ≥ ₹5,000 are held, not denied. Budget is reserved while a person decides. Approval re-runs every other guardrail against current state. |
| **Razorpay settlement** | Real test-mode Orders and Payment Links. `PAID` only inside the webhook handler, after HMAC-SHA256 over the raw body verifies. |
| **Agent recovery** | On denial the agent reads *which* check failed and re-plans against that specific bound — a budget denial becomes a cheaper search, a stock denial excludes that product. It retries once, then stops and explains. |
| **MCP server** | 8 tools over the public HTTP API, so any MCP client can transact. |

### Sell side — growing the revenue

| Feature | What it is |
|:---|:---|
| **Offer builder** | Three shapes that actually move retail revenue and are all expressible as verifiable arithmetic: `bundle` (attach a complement — AOV up), `volume` (unit price falls at a threshold — units up), `upgrade` (a better item, delta narrowed — mix up). |
| **Merchant-private economics** | Cost price in its own table, absent from the `Product` model and from every agent-facing route. Derived deterministically per product so the demo reproduces identically on any machine. |
| **Nine-check margin gauntlet** | The mirror of the buy side. Authorisation, then truthfulness, then the merchant's bounds, then the *buyer's* bounds, then the human gate. |
| **Budget-aware merchandising** | Present a mandate to `GET /growth/offers` and offers are fitted to what that buyer may actually spend. An offer the buyer could not accept is never made. |
| **Campaigns** | The merchant's own mandate: a discount budget with a margin floor beneath and a human gate above, with the identical three-phase ledger. |
| **Deep-discount gate** | Discounts ≥ ₹800 are held for a person, with the discount reserved so a second offer cannot overcommit while they decide. |
| **Campaign orchestrator** | A deterministic rebalance pass — promote overstocked lines that carry margin, withdraw those thin on stock or margin. Every move names its observation; the pass is one audit row. |
| **Revenue attribution** | Uplift, AOV with/without offer, attach rate, discount given, margin earned — all measured against a counterfactual recorded when the offer was built. |
| **`margin_protected`** | The discount the gauntlet refused to give away. A number that exists only because suppressed offers are recorded rather than dropped. |

### Shared

| Feature | What it is |
|:---|:---|
| **One audit chain** | `hashₙ = SHA-256(hashₙ₋₁ ‖ canonical_json(eventₙ))`. Buy-side and sell-side events interleave in the order they happened. Append-only *at the database level* — SQLite triggers abort UPDATE and DELETE. |
| **Live streaming** | Server-Sent Events push each new block to the control room with auto-reconnect. |
| **Control room** | Eight views. Offer studio, offer ledger with the full gauntlet per offer, campaign meter, revenue attribution, budget meters, intent ledger, live chain, scenario runner. |
| **11 scripted scenarios** | One click each, against the real services. Seven buy-side, four sell-side. Five of them are failures. |
| **176 tests** | Every check in isolation, both ledgers, webhook verification, chain integrity, agent recovery, and the architectural invariants. |

---

## 3 · Build challenges and technical obstacles

These are the ones that actually cost time or changed the design.

### 3.1 · Keeping the margin floor load-bearing

**Problem.** The obvious way to build an offer is: compute the deepest discount that still clears the margin floor, then offer that. But then the floor never *fires* — it is arithmetic inside the builder, invisible, untestable as a decision, and unprovable to a judge.

**Fix.** `growth/offers.py` is **structurally denied cost data**. It never imports `economics`. It proposes the most persuasive offer the campaign's *published* ceiling allows, and the gauntlet — which does see cost — refuses what the merchant cannot afford.

The consequence is that suppressed offers are a normal, frequent outcome rather than an error path, which in turn is what makes `margin_protected` a real number. There is a test that reads the engine's own source and fails if it ever imports a database or an HTTP client.

### 3.2 · An offer can smuggle a category past a mandate

**Problem.** Adding offers to the buy side looked like a one-line change: let the intent carry an `offer_id` and price from the offer. It is not. A bundle contains *more than one product*, and the buy-side checks were all written against a single anchor:

- `category_allowed` checked the anchor's category — so a bundle could pair an authorised mouse with an unauthorised yoga mat and walk straight through a mandate scoped to `electronics`.
- `stock_available` checked the anchor's stock — so a bundle could be charged for with its complement out of stock.
- `product_exists` compared the amount to `price × qty` — which is simply wrong once a discount exists.

**Fix.** Three checks became offer-aware, and a ninth check, `offer_honoured`, was added at position 3 — before anything downstream depends on the offer being real. It re-fetches the offer server-side and re-prices it against the live catalog. The merchant may make an offer; it may not change one already accepted.

The `category_allowed` failure message says so explicitly: *"A bundle cannot widen a mandate's scope."*

### 3.3 · An upgrade changes what is being bought

**Problem.** A bundle adds to the anchor. An **upgrade replaces it** — the agent searched for a ₹1,299 mouse and ends up buying a ₹1,699 one. The first implementation recorded `product_id = the mouse the agent searched for` while charging for and shipping the upgrade. The ledger was lying, and worse, `stock_available` was checking the wrong product entirely: an out-of-stock anchor could be "bought" via an upgrade that dodged its own stock check.

**Fix.** When an offer is attached, the intent records the offer's primary line as its product; the offer's `anchor_product_id` separately remembers what the buyer originally wanted, which is what attribution measures uplift against. Settlement decrements stock for **every** line, not just the anchor. And the agent's own closing message was corrected to name what it actually bought — *"Bought Aurora Vertical Ergonomic Mouse (upgraded from Aurora Wireless Optical Mouse)"* — because a project about truthful money actions cannot have its agent misreport the purchase.

### 3.4 · An agent that accepts every upsell is worthless

**Problem.** The easy demo is: merchant offers, agent accepts, revenue goes up. It is also indefensible. An agent instructed to buy *one wireless mouse* has no authority to spend its principal's money on earphones, however real the saving. An agent that takes every offer is not representing anybody, and a judge will notice.

**Fix.** The buyer agent got an explicit fiduciary policy, and the test is not "is this a good deal" but "is this still the purchase I was asked to make":

- **Bundle** → declined. It adds an item nobody asked for.
- **Volume** → declined. It commits to three when one was wanted.
- **Upgrade** → accepted, but only if the premium stays under 45%, the merchant is funding at least 3% of the step, and any price ceiling in the original instruction still holds.

This made the demo *better*, not weaker. The uplift now comes from a buyer that refused twice first — and declining is not free for the merchant either, since it releases the discount the campaign was holding.

### 3.5 · Two ledgers racing each other

**Problem.** The margin gauntlet evaluates campaign budget as a pure function, from a snapshot. Between that evaluation and the commit, another offer can take the remaining budget. Trusting the gauntlet's verdict would overcommit the campaign.

**Fix.** `campaigns.reserve()` puts the availability test in the SQL `WHERE` clause, exactly as the mandate ledger does, and returns whether a row actually changed. When the ledger refuses what the gauntlet allowed, the offer is recorded as suppressed with a check that says precisely that: *"Another offer claimed the remaining discount budget before this one committed."* The lost race is a first-class outcome with its own audit row, not an exception.

### 3.6 · The campaign defaults suppressed literally everything

**Problem.** First run with a 12% margin floor: **every** offer on **every** electronics product was suppressed. Consumer electronics carries roughly 18% gross margin; a 9% discount lands the post-discount margin near 8%. The floor was above the ceiling of what the category could support, so the shelf was empty and the demo showed nothing.

**Fix.** This is a real merchandising calibration problem, not a bug — and the fix was to derive the defaults from the catalog's actual economics. The floor moved to 8%, which passes the bundle at 8.28% and genuinely refuses the volume tier at 5.06%. The gate moved to ₹800 of discount, which the cheap lines never reach and a bundle on the ₹12,499 chair always does.

The result across three representative products is a mix of published, suppressed on `margin_floor`, suppressed on `campaign_budget`, and gated — four different guardrails visibly doing work. The reasoning is written into the constants so the next person can re-derive it.

### 3.7 · An out-of-stock product still generated offers

**Problem.** `stock_cover` checks the *offer's lines*. For an upgrade, the anchor is not one of them — so a sold-out product happily produced an "upsell" to something else. Defensible retail behaviour ("that's gone, try this"), but it broke the coherence of an intent flow anchored on the product the buyer chose, and it silently defeated the out-of-stock recovery scenario.

**Fix.** `quote_offers` returns an empty shelf when the anchor has no stock, with the reason stated rather than an unexplained blank.

### 3.8 · A number that stayed at zero forever

**Problem.** The dashboard's revenue uplift rendered `₹0.00` next to its own correctly-computed `+21.6%`. The `CountUp` component skips its tween when the tab is hidden or reduced-motion is set — and in that branch it updated its ref but not its display state. Once the skip cleared, the equality check `start === value` returned early, and the stale zero became permanent. Any figure that changed while the tab was in the background read as zero from then on.

**Fix.** Sync the display state in both branches. Pre-existing bug, found by looking at the rendered page rather than trusting the build.

### 3.9 · The build was broken before we started

`main` did not compile. `app/page.tsx` imported a `StatStrip` that was never defined, and `live-metrics.tsx` defaulted a prop to `"closed"` where the type only admits `"connecting" | "live" | "offline"`. Both were fixed — `StatStrip` was written as the proof strip it was clearly meant to be. Worth stating plainly because it means the repo now type-checks for the first time.

### 3.10 · A 53 MB hero GIF

The landing page's hero animation was a 53 MB GIF — slow to paint, expensive to decode on the CPU, and the dominant weight of the entire repository. Re-encoded to h264 at 1.5 MB (a 35× reduction) and served through a `<video>` element with `motion-reduce:hidden`. Removing it and the login page's own 5 MB GIF took ~56 MB out of git history going forward.

### 3.11 · A logo that turned to mush

The first two marks were hand-traced rupee glyphs. Both were legible at 80px and both collapsed by 16px — one into a backslash, the other into a blob. Rendering four candidates side by side at 96 / 48 / 32 / 20 / 16 px made it obvious that the real U+20B9 glyph was the only version that survived. The final mark is `[₹]`: two brackets, which read as *bounds* to anyone who has seen a line of code, with the money between them. Two brackets because both sides of the counter are bounded; the left is drawn heavier because the buy side is the one holding against an untrusted agent.

---

## 4 · Deliberate substitutions

Both exist so the whole demo reproduces on any machine with no network, no keys and no cold start.

| Substitution | Why it is honest |
|:---|:---|
| **SQLite instead of Postgres + pgvector** | Vectors stored as blobs, cosine similarity in numpy. On a 33-item catalog this is behaviourally identical, and the schema is plain SQL a judge can read. The append-only guarantee is arguably *stronger* — it is enforced by database triggers. |
| **Deterministic hashing embedder instead of `sentence-transformers`** | No 2 GB torch download, and identical vectors on every machine, which makes search results reproducible in a recorded demo. `EMBEDDINGS_BACKEND=sentence-transformers` switches to `all-MiniLM-L6-v2` with no other change. |

---

## 5 · Where this would go next

Honest gaps, in the order we would close them:

1. **Multi-merchant.** The mandate already binds to a merchant id and `merchant_match` enforces it, but there is one merchant in the database. A registry and a per-merchant campaign scope is the obvious next step.
2. **Offer personalisation from history.** Attach rates are computed but not fed back. The orchestrator currently reasons over stock and margin; purchase history is the missing third signal.
3. **Real UAP.** The mandate implements UAP's *pattern* rather than its wire format, because UAP is not live. When it ships, the mandate module is the only thing that should have to change.
4. **Settlement reconciliation.** Razorpay settlement reports are not pulled; the chain currently ends at the payment webhook rather than at money in the merchant's bank.
