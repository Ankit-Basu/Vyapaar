# Spoken script — read this straight through

Roughly **2:50** at a natural pace. Bracketed lines are stage directions, not
narration — skip them out loud.

For timings, the shot list, delivery notes and anticipated judge questions, see
[VIDEO_PITCH.md](VIDEO_PITCH.md). This file is just the words.

---

Hi, I'm Ankit, and this is Vyapaar.

Track One asks for two things: make a merchant sellable to AI buyers, and grow that merchant's revenue. Most projects pick one — a safe agent that buys, or an upsell bot. Vyapaar does both, because they're the same problem pointed in opposite directions.

Giving a discount is spending money, exactly like buying is. So the merchant gets what the buyer gets — a limit, a floor it can't cross, and a human sign-off for anything big. One machine, built twice, facing each other across a counter.

*[landing page — scroll slowly, twenty seconds]*

The landing page is the whole argument in one scroll. Nine guardrails light up one at a time; that's the buy side. Nine more below them bound the merchant. And the audit chain assembles block by block — hit simulate tamper, and every block after it breaks.

Nine and nine. A hundred and seventy-eight tests. Zero rupees at risk — test mode end to end.

*[cut to the dashboard]*

One merchant on Razorpay test mode. I'll grant a mandate: three thousand per purchase, ten thousand total, electronics and office only. It's a signed token carrying the limits but not the spending — that lives on the server, so an agent that edits its own token changes nothing.

Now I'll tell it to buy a wireless mouse.

It searches, picks one, says why — then asks permission, and nine guardrails run, each with a reason in plain English. And notice: the API doesn't even accept an amount. You send a product and a quantity, and the server prices it. There's no field for an agent to lie in.

*[offer studio — Ask the merchant for offers]*

Now the merchant sells back. Three offers: a bundle, an upgrade, a bulk deal. And its own guardrails refuse one — after four-sixty-seven off, this earns five percent margin, below the floor of eight. Growing revenue by selling at a loss is not growth.

Now watch what happens with a smaller mandate.

*[switch to Tight mandate, click again — pause a full second]*

Same product. Same campaign. Different buyer. The bundle is gone, because at one thousand seven twenty-seven it's above what this buyer may spend. And this wasn't blocked at checkout. The offer was never made.

The buyer agent is a fiduciary, not a shopper. It turned the bundle down — it was asked for a mouse, and it can't spend someone else's money on earphones. It took the upgrade instead: same job, better product, merchant funding part of the step.

Revenue up twenty-one percent, measured against what this buyer would have paid with no offer at all. And beside it, margin protected — the discount the guardrails refused to give away.

*[Scenarios → Card declined]*

One failure, handled. Card declined, intent fails, budget hold released. A charge that never lands never costs anyone budget.

*[Audit trail]*

All of it lands on one chain. Every row seals the one before it. Edit history and the seal breaks — the database itself blocks it.

Both sides bounded. Every refusal recorded. That's Vyapaar.
