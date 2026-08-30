# Deploying Vyapaar

A public URL a judge can click is worth more than any feature you could add in
the same time. This gets you one in about 25 minutes.

---

## Is it free?

**Yes, for this.** Both plans cover a hackathon project at zero cost.

| | Plan | Cost | The catch |
|:---|:---|:---|:---|
| **API** (FastAPI) | Render Free instance | **$0** | Spins down after **15 minutes** without traffic; the next request takes **~1 minute** to wake it. **750 instance hours** per workspace per calendar month. No persistent disk. |
| **Web** (Next.js) | Vercel Hobby | **$0** | **Personal, non-commercial use only.** 1M edge requests and 100 GB data transfer per month. You cannot buy extra usage on the free plan. |

Two things worth knowing before you start:

**The 750 hours actually cover an always-on month.** A 31-day month is 744
hours, so keeping the API awake around the clock fits inside the grant — just.
That matters, because the 1-minute cold start is the single thing most likely to
make your demo look broken. See [Keeping it awake](#5--keeping-it-awake-do-this-before-you-submit).

**Vercel Hobby is non-commercial.** A buildathon entry is a personal project, so
you are fine. If Vyapaar later becomes a product with customers, that plan no
longer applies.

**Render may ask for a card** to verify the account before it will run compute
(static sites do not require one; web services sometimes do). It is a
verification hold, not a charge, as long as you stay on the Free instance type.
Reports vary, so do not be surprised either way.

*Verified August 2026 — check the links at the bottom, since both change terms.*

---

## Before you start

- [ ] The repo is pushed to GitHub. ✅ already done
- [ ] A GitHub account (you have one)
- [ ] A Render account — sign in with GitHub, it is quickest
- [ ] A Vercel account — sign in with GitHub

Nothing needs to be installed locally. Both platforms build from the repo.

---

## The order matters

There is a circular dependency, and getting it wrong is the most common way this
goes sideways:

> The **web app** needs the API's URL to talk to it.
> The **API** needs the web app's origin to allow it through CORS.

So you deploy the API first with a placeholder, deploy the web app, then come
back and fix the API's CORS setting.

```
1. API on Render      →  get https://vyapaar-api.onrender.com
2. Web on Vercel      →  get https://vyapaar.vercel.app
3. Back to Render     →  set CORS_ORIGINS to the Vercel URL
4. Verify
```

---

## 1 · The API on Render

The repo already contains [`Dockerfile`](../Dockerfile) and
[`render.yaml`](../render.yaml), so Render can configure itself.

1. Go to **[dashboard.render.com](https://dashboard.render.com)** and sign in
   with GitHub.
2. Click **New +** (top right) → **Blueprint**.
3. Connect your GitHub account if prompted, then pick the **Vyapaar**
   repository.
4. Render reads `render.yaml` and proposes one service: **`vyapaar-api`**.
   Give the blueprint any name you like.
5. It will ask you to fill in **one** environment variable — `CORS_ORIGINS`,
   the only one marked `sync: false` because it cannot be guessed. Enter:

   ```
   http://localhost:3000
   ```

   You will replace this in step 3. Everything else — including
   `MANDATE_JWT_SECRET`, which is generated on the platform and never committed
   — is filled in automatically.
6. Click **Apply** / **Create**. The first build takes roughly **3–5 minutes**
   (installing numpy is the slow part).
7. When it goes green, copy the service URL from the top of the page. It looks
   like `https://vyapaar-api.onrender.com`.

**Check it worked:**

```bash
curl -s https://vyapaar-api.onrender.com/health
```

You want `"status":"ok"` and `"catalog_products":33`. The service creates its
schema, seeds 33 products, derives unit economics and opens a campaign on boot,
so there is nothing to run by hand.

> If this is the first request in a while it may take a minute — that is the
> spin-up, not a failure.

---

## 2 · The web app on Vercel

1. Go to **[vercel.com/new](https://vercel.com/new)** and sign in with GitHub.
2. **Import** the **Vyapaar** repository.
3. **This is the one setting that matters.** Expand the configuration and set:

   ```
   Root Directory:  apps/web
   ```

   This is an npm-workspaces monorepo and Vercel has to be told which app to
   build. Leave the Framework Preset on **Next.js** — it will detect it once the
   root directory is right.
4. Expand **Environment Variables** and add:

   | Name | Value |
   |:---|:---|
   | `NEXT_PUBLIC_API_URL` | `https://vyapaar-api.onrender.com` |

   **No trailing slash.** This is inlined at build time, so if you change it
   later you must redeploy — restarting is not enough.
5. Click **Deploy**. Takes about 2 minutes.
6. Copy your URL: `https://<your-project>.vercel.app`.

At this point the site loads but every panel will say it cannot reach the API.
That is expected — CORS is not open yet.

---

## 3 · Close the loop

1. Back in **Render** → your `vyapaar-api` service → **Environment** in the left
   sidebar.
2. Edit **`CORS_ORIGINS`** and replace the placeholder with your Vercel URL:

   ```
   https://<your-project>.vercel.app
   ```

   No trailing slash. Comma-separate if you want more than one origin — adding
   `http://localhost:3000` as well lets your local frontend hit the deployed API
   too, which is handy.
3. **Save changes.** Render restarts the service automatically (~1 minute).

**Check the browser will actually be allowed through:**

```bash
curl -s -o /dev/null -D - \
  -X OPTIONS https://vyapaar-api.onrender.com/catalog/feed \
  -H "Origin: https://<your-project>.vercel.app" \
  -H "Access-Control-Request-Method: GET" | grep -i access-control-allow-origin
```

You want your Vercel origin echoed back. If the header is missing, the value
does not match *exactly* — check for a trailing slash, or `http` vs `https`.

---

## 4 · Verify it end to end

Open `https://<your-project>.vercel.app/dashboard` and walk this list:

- [ ] Header shows **chain intact** and **33 products**
- [ ] The status line reads **streaming** — that means SSE is connected all the
      way through to Render, which is the part most likely to break on a host
- [ ] **Reset demo** works
- [ ] Offer studio → **Ask the merchant for offers** returns offers
- [ ] Switch to **Tight mandate** → offers are withheld on `buyer_bounds`
- [ ] **Scenarios** → run **Agent discovers, prices and buys** → it settles
- [ ] **Audit trail** fills and the chain badge stays green

If all seven pass, you have a live demo.

---

## 5 · Keeping it awake (do this before you submit)

This is the step people skip and regret.

A Free instance sleeps after 15 minutes idle and takes about a minute to wake.
A judge who clicks your link cold sits watching a blank page and concludes it is
broken. You do not get to explain.

**Fix it with a free uptime pinger.** Point one at your health endpoint every
10 minutes:

```
https://vyapaar-api.onrender.com/health
```

- [cron-job.org](https://cron-job.org) — free, no card
- [UptimeRobot](https://uptimerobot.com) — free tier, 5-minute intervals

An always-on month costs about 720–744 instance hours against the 750 granted,
so this fits — but it is tight. Do not run a second Free service in the same
workspace during your judging window or you will exhaust the grant and both will
stop.

**Alternative:** switch to Render's cheapest paid instance for the few days
around judging. It does not sleep, and it is a couple of dollars.

---

## Troubleshooting

| Symptom | Cause | Fix |
|:---|:---|:---|
| Panels say *"Cannot reach the Vyapaar API"* | CORS, or the env var is wrong | Open the browser console — the failing request names which. Then re-check step 3. |
| Status line stuck on **connecting** | SSE blocked | Confirm `CORS_ORIGINS` exactly matches your Vercel origin. SSE is subject to CORS like any other request. |
| Everything works locally, nothing works deployed | `NEXT_PUBLIC_API_URL` still points at localhost | It is inlined at build time. Fix it in Vercel and **redeploy**. |
| First load takes a minute | Free instance was asleep | Expected. Set up the pinger in step 5. |
| Build fails on Render: seed file not found | The Docker layout was changed | `config.py` resolves the repo root as `parents[3]`. `services/api` and `seed` must keep their depths — do not flatten them into the working directory. |
| Data disappeared after a while | The service restarted | Deliberate. There is no persistent disk; the app re-seeds a clean merchant on every boot, which is the state a demo wants anyway. |
| Vercel builds the wrong thing | Root Directory not set | It must be `apps/web`. This is the most common mistake. |

---

## Notes on the design

**SQLite on an ephemeral disk is deliberate, not a shortcut.** The service
creates its schema, seeds 33 products, derives unit economics and opens a
campaign on every boot. A restart returns to a clean working merchant — exactly
what `POST /demo/reset` does on purpose. Nothing here is a record of real money,
so there is nothing to lose, and it means the Free plan's lack of a persistent
disk costs you nothing.

**Razorpay stays on the simulator.** With real test keys the simulator disables
itself and settlement waits for a webhook Razorpay must be able to reach. That
*is* possible now that the API is public — point a webhook at
`https://vyapaar-api.onrender.com/payments/webhook` and set
`RAZORPAY_WEBHOOK_SECRET` — but it is one more thing to fail on stage. The
simulator signs with the same HMAC-SHA256 the real gateway does, so the
verification path is genuinely exercised either way.

**Other hosts.** The `Dockerfile` is not Render-specific: it reads `$PORT` and
binds `0.0.0.0`, so Railway and Fly.io work unchanged. Railway does not sleep on
its trial credit, which may suit a judging window better.

```bash
docker build -t vyapaar-api .
docker run -p 8000:8000 -e CORS_ORIGINS=http://localhost:3000 vyapaar-api
```

---

## Sources

Terms change — verify before you rely on them.

- [Render — Deploy for Free](https://render.com/docs/free)
- [Render pricing](https://render.com/pricing)
- [Vercel pricing](https://vercel.com/pricing)
- [Vercel limits](https://vercel.com/docs/limits)
