# إيدوبا — Eduba website + Stream payments

Rebuild of the public eduba.tech site (Next.js 15, Tailwind v4, Arabic RTL) with
payments on [Stream](https://streampay.sa): embedded checkout for **إيدوبا Pro
(115 ريال/شهر)**, server-side payment verification, signed webhooks, a
customer portal link, and a read-only `/admin` dashboard fed live from the
Stream API.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router, Turbopack), React 19, TypeScript |
| Styling | Tailwind CSS v4, lucide-react, self-hosted Cairo + Tajawal fonts |
| Database | Postgres via Drizzle ORM (`lib/db/schema.ts`, migrations in `drizzle/`) |
| Auth | Auth.js v5 (credentials: email/username + password, JWT sessions) |
| Payments | Stream API v2 (server-only client in `lib/stream/client.ts`) + Stream Embed SDK |
| Tests | Vitest (unit + DB-backed webhook test), Playwright end-to-end against a local mock of Stream |

## Quick start (local)

```bash
cp .env.example .env            # fill in DATABASE_URL, AUTH_SECRET, ADMIN_EMAILS
npm install
npm run db:migrate              # creates the tables
npm run user:create -- --email you@example.com --password "min 8 chars" --name "Admin"
npm run dev                     # http://localhost:3000
```

Two ways to run payments locally:

1. **Mock Stream (no account needed)** — in a second terminal `npm run stream:mock`, and in `.env`:
   `STREAM_API_BASE_URL=http://127.0.0.1:4567/api/v2`, `STREAM_API_KEY=mock`, `STREAM_API_SECRET=mock`,
   `STREAM_PRODUCT_PRO_MONTHLY_ID=mock-pro-monthly`, `STREAM_PRODUCT_TEST_ONE_TIME_ID=mock-test-one-time`,
   `STREAM_WEBHOOK_SECRET=mock-webhook-secret`. The mock serves a fake hosted checkout with
   "approved card / Apple Pay / 3 instalments / declined card" buttons and posts signed webhooks to the app.
2. **Stream sandbox** — put your *sandbox* key pair in `.env`, then `npm run stream:setup` (see below).
   Webhooks need a public HTTPS URL, so for local sandbox testing expose port 3000 with a tunnel
   (e.g. `cloudflared tunnel --url http://localhost:3000`) and set `NEXT_PUBLIC_APP_URL` to it before running the setup.

Brand images: the repo ships lightweight placeholders. Run `npm run assets:download`
(on a machine that can reach eduba.tech) to copy the real logo/mascots into `public/`.

## Stream setup

```bash
npm run stream:setup                      # verifies the key pair (refuses live keys), creates the Pro product, registers the webhook
npm run stream:setup -- --with-test-product   # also creates a 300 SAR one-time product to test installments
```

The script prints `STREAM_PRODUCT_PRO_MONTHLY_ID`, `STREAM_WEBHOOK_SECRET` (and the test product id)
to copy into `.env` / Vercel. It is idempotent; if a webhook for the URL already exists it tells you to
reuse the secret you saved (Stream never returns it again).

Hosted alternative: create the product in the Stream dashboard (Products → recurring, monthly, 115 SAR) and
the webhook under Settings → Webhooks (URL `https://<domain>/api/webhooks/stream`, choose a secret), then
copy the ids/secret into the env.

## Environment variables

See `.env.example` for the full list with comments. Required in production:
`NEXT_PUBLIC_APP_URL`, `DATABASE_URL`, `AUTH_SECRET`, `ADMIN_EMAILS`, `STREAM_API_KEY`, `STREAM_API_SECRET`,
`STREAM_WEBHOOK_SECRET`, `STREAM_PRODUCT_PRO_MONTHLY_ID`. Optional: `STREAM_API_BASE_URL`,
`STREAM_PRODUCT_TEST_ONE_TIME_ID`, `STREAM_ENABLE_AMEX`, `STREAM_DASHBOARD_URL`, `STREAM_WEBHOOK_TOLERANCE_SECONDS`,
`NEXT_PUBLIC_STREAM_EMBED_SCRIPT_URL`.

Secrets are read on the server only (`lib/env.ts`); nothing Stream-related is exposed to the browser except
the public embed script URL.

## How the payment flow works

1. `اشترك في Pro` → `/checkout?plan=pro_monthly` collects name, phone (normalised to E.164), email
   (prefilled for signed-in users).
2. Server action `startCheckout` → `createCheckout()` (`lib/checkout/service.ts`):
   search Stream consumers by exact email, then exact phone → create only if none → store the mapping in
   `customers` → `POST /payment_links` for **one** product, bound to that consumer, `max_number_of_payments: 1`,
   success/failure redirect URLs carrying our `order` id, `custom_metadata.order_id`. Installments
   (`payment_methods.installment`) are requested only for one-time products; recurring links keep the
   organisation defaults (Stream disables installments on subscriptions anyway).
3. The page renders `Stream.Checkout({ paymentLink, container })` from `stream-embed.streampay.sa` with a
   fallback link to the hosted page. When the payer finishes, Stream redirects the top window to
   `/checkout/success?order=…&invoice_id=…`.
4. `/checkout/success` never trusts the query string: it fetches the invoice from Stream and checks that it
   belongs to this order's payment link and consumer, has the expected amount and currency, and is paid
   (`COMPLETED`, or first instalment succeeded for `INSTALLMENTS`). Only then is the order marked `paid`, the
   subscription mirrored, and "تم الدفع بنجاح" shown. While Stream is still settling it polls
   `/api/checkout/status` (same verification) for up to 90 s.
5. `/api/webhooks/stream` reads the raw body, verifies `X-Webhook-Signature` (`t=…,v1=HMAC-SHA256(secret, "t.body")`),
   rejects timestamps older than 5 minutes, deduplicates deliveries in `webhook_events` (Stream retries up to 5×),
   and re-runs the same verification / subscription sync. Handler errors return 500 so Stream retries;
   duplicates return 200 immediately.
6. `/account` shows the plan and opens Stream's Customer Portal (`POST /consumer_portal/sessions`) for card
   updates, invoices and cancellation.

## Admin (`/admin`)

Login + allow-list (`ADMIN_EMAILS`, re-checked server-side on every request). Tabs: overview cards
(revenue this month, active subscriptions, failed payments), invoices & payments (`GET /invoices?include_payments=true`,
the only Stream list that includes the customer), payments, subscriptions (next billing = `current_period_end`),
customers. Filters (date range, status, free-text/customer) and pagination are passed straight to the Stream API.
Every row links to the Stream dashboard. Read-only — no refunds or cancellations from here.

## Apple Pay / wallets

`public/.well-known/apple-developer-merchantid-domain-association` is Stream's domain-verification file (copied
from `https://streampay.sa/.well-known/…`). Deploy it, then ask Stream support to register your domain(s) and
enable Apple Pay / Samsung Pay on the organisation — see `docs/HANDOVER.md` for the exact request. The embed
iframe is created by Stream's SDK with `allow="payment *"`, so wallets work inside the embedded checkout once enabled.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run test` | Vitest (unit tests + webhook integration test when `DATABASE_URL` is reachable) |
| `node tests/e2e/mock-flow.mjs` | Playwright end-to-end run against `npm run stream:mock` + a running site |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle migrations / browser |
| `npm run stream:setup` | Create Stream product(s) + webhook, print env values |
| `npm run stream:mock` | Local fake Stream API + hosted checkout on :4567 |
| `npm run user:create` | Create / reset a site user from the CLI |
| `npm run assets:download` | Copy the real brand images from the live site into `public/` |

## Deploying on Vercel

1. Import the repo (or run `vercel`), framework Next.js.
2. Storage → Create Database → **Postgres (Neon)** → it sets `DATABASE_URL`.
3. Add the other env vars from `.env.example` (Production + Preview).
4. The build runs `drizzle-kit migrate && next build`, so tables are created on the first deploy.
5. Run `NEXT_PUBLIC_APP_URL=https://<your-domain> npm run stream:setup` once from your machine
   (with the sandbox or production key pair) to register the webhook for that domain, then add the printed
   `STREAM_WEBHOOK_SECRET` / product ids to Vercel and redeploy.
6. Create your admin login with `npm run user:create` against the production `DATABASE_URL`.
