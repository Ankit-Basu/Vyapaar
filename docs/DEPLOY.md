# Deploying Vyapaar

A public URL a judge can click is worth more than any feature you could add in
the same time. This gets you one in about twenty minutes.

**Two services, because they want different things.** The API needs a long-lived
process — `/audit/stream` is Server-Sent Events, and an open connection is the
whole point of it. The web app is static and wants a CDN.

| | Where | Why |
|:---|:---|:---|
| API (FastAPI) | Render, from the `Dockerfile` | Long-lived process, SSE stays open |
| Web (Next.js) | Vercel | Static output, edge CDN, no cold start |

---

## Order matters

There is a circular dependency: the web app needs the API's URL, and the API
needs the web app's origin to allow CORS. So:

**API → web → come back and set `CORS_ORIGINS`.**

---

## 1 · The API on Render

1. Push to GitHub (already done).
2. Render → **New** → **Blueprint** → pick this repository. It reads
   [`render.yaml`](../render.yaml) and proposes a `vyapaar-api` web service.
3. It will ask for **`CORS_ORIGINS`**, the one value marked `sync: false`. Put
   `http://localhost:3000` for now; you will come back to it in step 3.
4. Deploy. First build is ~3 minutes (it installs numpy).
5. Check it:

```bash
curl -s https://vyapaar-api.onrender.com/health
```

You want `"status":"ok"` and `"catalog_products":33`. The service seeds its own
catalog, unit economics and campaign on boot, so there is nothing to run by hand.

> **The free plan sleeps after 15 minutes idle**, and the next request takes
> ~50 seconds to wake it. That is fine while you are building and *not* fine
> when a judge clicks your link cold. Before you submit, either move to Render's
> paid instance for a few days, or hit `/health` from a free uptime pinger every
> 10 minutes. A demo that takes a minute to load reads as broken.

---

## 2 · The web app on Vercel

1. Vercel → **Add New** → **Project** → same repository.
2. **Root Directory: `apps/web`.** This is the only setting that matters — it is
   an npm-workspaces monorepo, and Vercel needs to be told which app to build.
   Leave the framework preset on Next.js.
3. Environment variable:

   ```
   NEXT_PUBLIC_API_URL = https://vyapaar-api.onrender.com
   ```

   No trailing slash. It is inlined at build time, so changing it later needs a
   redeploy, not just a restart.
4. Deploy.

---

## 3 · Close the loop

Back in Render → the service → **Environment**, set:

```
CORS_ORIGINS = https://<your-project>.vercel.app
```

Comma-separated if you want more than one, no trailing slash. Save; Render
restarts the service.

Then confirm the browser will actually be allowed through:

```bash
curl -s -o /dev/null -D - \
  -X OPTIONS https://vyapaar-api.onrender.com/catalog/feed \
  -H "Origin: https://<your-project>.vercel.app" \
  -H "Access-Control-Request-Method: GET" | grep -i access-control-allow-origin
```

You want your Vercel origin echoed back. If the header is missing, `CORS_ORIGINS`
does not match the origin exactly — check for a trailing slash or `http` vs
`https`.

---

## 4 · Check it end to end

Open `https://<your-project>.vercel.app/dashboard`.

- [ ] The header shows **chain intact** and **33 products**
- [ ] The status line says **streaming** — that is SSE connected through to Render
- [ ] **Reset demo** works
- [ ] The offer studio returns offers, and **Tight mandate** withholds them on
      `buyer_bounds`
- [ ] A scenario runs green

If the panels say *"Cannot reach the Vyapaar API"*, it is CORS or the env var —
open the browser console, the failing request names which.

---

## Notes

**SQLite on ephemeral disk is deliberate here, not a shortcut.** The service
creates its schema, seeds 33 products, derives unit economics and opens a
campaign on every boot. A restart returns to a clean working merchant, which is
exactly the state you want a demo to start in — `POST /demo/reset` does the same
thing on purpose. Nothing in this system is a record of real money.

**Razorpay stays on the simulator.** With real test keys the simulator disables
itself and settlement waits for a webhook Razorpay must be able to reach. That is
possible on Render (the URL is public — point a webhook at
`https://vyapaar-api.onrender.com/payments/webhook` and set
`RAZORPAY_WEBHOOK_SECRET`), but it is one more thing to break on stage. The
simulator signs with the same HMAC-SHA256 the real gateway does, so the
verification path is genuinely exercised either way.

**Other hosts.** The `Dockerfile` is not Render-specific — it reads `$PORT` and
binds `0.0.0.0`, so Railway and Fly.io work with no changes. Railway does not
sleep on its trial, which may suit you better for a judging window.

```bash
docker build -t vyapaar-api .
docker run -p 8000:8000 -e CORS_ORIGINS=http://localhost:3000 vyapaar-api
```
