# Checkout and Rewards Service

A transaction-safe ecommerce reference application built for the Uniblox interview assignment. Customers manage carts and check out with persisted idempotency; MySQL/InnoDB protects inventory, order sequencing, and one-time coupon redemption under concurrent requests. A compact React interface exercises the complete API.

All money is INR in integer paise. `899900` means ₹8,999.00.

## Architecture

```text
React/Vite UI
    -> Express routes + Zod boundary validation
        -> focused cart/checkout/coupon/report services
            -> Knex transactions
                -> MySQL 8 / InnoDB constraints and row locks
```

The checkout service deliberately contains the transaction orchestration in one readable module. It locks the persisted idempotency record, cart, products (ascending ID), optional coupon, and successful-order counter; all writes commit or roll back together. See [DECISIONS.md](./DECISIONS.md) for the precise invariants and race analysis.

## Prerequisites

- Node.js 18+
- npm 10+
- Docker with Compose v2

## Fresh-clone setup

```bash
cp .env.example .env
cp .env.test.example .env.test
npm install
docker compose up -d mysql mysql-test
npm run migrate
NODE_ENV=test npm run migrate
npm run seed
npm test
```

The Compose file maps development MySQL to host port `3307` and test MySQL to `3308`, avoiding common collisions with an existing local MySQL on `3306`. Override with `MYSQL_HOST_PORT` or `MYSQL_TEST_HOST_PORT`. Inside Docker both use MySQL's standard port 3306.

Wait until both containers are healthy before migration:

```bash
docker compose ps
```

Start the applications in separate terminals:

```bash
npm run dev
npm run dev:frontend
```

Open `http://localhost:5173`. The API health check is `http://localhost:5000/health`.

If port 5000 is occupied (macOS AirPlay Receiver commonly uses it), set another value such as `PORT=5050` and point `VITE_API_BASE_URL` to the same backend origin. Startup exits nonzero with the actual listen error rather than falsely reporting success.

## Commands

| Purpose | Command |
| --- | --- |
| Start databases | `docker compose up -d mysql mysql-test` |
| Development migration | `npm run migrate` |
| Test migration | `NODE_ENV=test npm run migrate` |
| Seed products | `npm run seed` |
| Backend development | `npm run dev` |
| Backend production | `npm start --workspace backend` |
| Frontend development | `npm run dev:frontend` |
| Integration tests | `npm test` |
| Deterministic API smoke workflow | `API_BASE_URL=http://127.0.0.1:5050/api npm run smoke --workspace backend` |
| Lint | `npm run lint` |
| Frontend production build | `npm run build` |
| Preview frontend build | `npm run preview --workspace frontend` |

The seed upserts five fixed product IDs and restores their names, prices, and inventory. It does not delete carts/orders/coupons. This makes it repeatable for initial/demo inventory setup but means it must only be intentionally run against production.

## Environment

| Variable | Default/example | Meaning |
| --- | --- | --- |
| `PORT` | `5000` | Express listen port |
| `DB_HOST` | `127.0.0.1` | MySQL host |
| `DB_PORT` | `3307` | Host MySQL port |
| `DB_NAME` | `checkout_service` | Database name |
| `DB_USER` / `DB_PASSWORD` | Docker credentials | MySQL credentials |
| `DB_POOL_MIN` / `DB_POOL_MAX` | `2` / `10` | Knex pool bounds |
| `COUPON_ORDER_INTERVAL` | `5` | Successful orders per reward milestone |
| `COUPON_DISCOUNT_PERCENT` | `10` | Generated coupon percentage |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Exact allowed CORS origin |
| `VITE_API_BASE_URL` | `http://localhost:5000/api` | Frontend API origin |

Vite is configured with the repository root as its environment directory, so the frontend and backend both read the root `.env`; a separate `frontend/.env` is not required.

Use `.env.test` with `NODE_ENV=test`, a different database, and a larger pool for genuinely competing integration requests. Tests truncate only the configured test database and reseed it before each case.

## API

All success bodies use `{ "data": ... }`. Errors use:

```json
{
    "error": {
        "code": "INSUFFICIENT_INVENTORY",
        "message": "Requested quantity is no longer available.",
        "details": { "productId": 5, "requested": 2, "available": 1 }
    }
}
```

### Products and carts

| Method | URL | Body | Success | Important errors |
| --- | --- | --- | --- | --- |
| `GET` | `/api/products` | — | `200`, current products/inventory | — |
| `POST` | `/api/carts` | `{}` | `201`, empty open cart | — |
| `GET` | `/api/carts/:cartId` | — | `200`, cart using current prices | `CART_NOT_FOUND` |
| `POST` | `/api/carts/:cartId/items` | `{ "productId": 1, "quantity": 2 }` | `201`, updated cart | validation, missing product, closed cart |
| `PATCH` | `/api/carts/:cartId/items/:productId` | `{ "quantity": 3 }` | `200`, updated cart | missing item, closed cart |
| `DELETE` | `/api/carts/:cartId/items/:productId` | — | `200`, updated cart | missing item, closed cart |

Adding an existing product sets its quantity to the submitted value. Availability is intentionally checked only at checkout because inventory can change after cart editing.

### Checkout and orders

`POST /api/carts/:cartId/checkout` requires `Idempotency-Key: 8-to-128-safe-characters` and accepts `{}` or `{ "couponCode": "SAVE-..." }`. A new checkout returns `201`; a completed same-key replay returns the original order with `200` and `meta.replayed: true`. The key is global to the checkout operation. Reusing it for another cart or coupon choice returns `409 IDEMPOTENCY_CONFLICT`.

```bash
curl -X POST http://localhost:5000/api/carts/1/checkout \
    -H 'Content-Type: application/json' \
    -H 'Idempotency-Key: demo-checkout-0001' \
    -d '{"couponCode":"SAVE-000005-AB12CD34"}'
```

`GET /api/orders/:orderId` returns the immutable order snapshot (`200`) or `ORDER_NOT_FOUND` (`404`). Checkout can also return validation `400`, missing resource `404`, empty-cart `422`, or state/inventory/coupon conflict `409`.

### Administrative operations

Authentication is intentionally out of scope; `/api/admin/*` must be protected at the gateway/application layer in production.

| Method | URL | Purpose | Success |
| --- | --- | --- | --- |
| `POST` | `/api/admin/coupons/generate` | Generate the oldest eligible unrewarded milestone | `201`, coupon; or `409` if none |
| `GET` | `/api/admin/coupons` | List coupons and statuses | `200` |
| `GET` | `/api/admin/orders` | List successful immutable order snapshots, newest sequence first | `200` |
| `GET` | `/api/admin/report` | Read-only order/coupon reconciliation | `200` |

The admin order list includes cart/order identifiers, successful sequence, timestamp, item name/quantity/checkout price/line subtotal, coupon snapshot, and gross/discount/net totals. It is intentionally unpaginated for this small assignment dataset; pagination is deferred for production scale.

## Database schema

- `products`: current price and inventory.
- `carts`, `cart_items`: mutable open-cart state with a composite item key.
- `orders`: one-per-cart immutable financial snapshot, unique successful sequence, and at-most-one order per non-null coupon.
- `order_items`: immutable product/name/price/quantity/line snapshots.
- `coupons`: unique code and unique milestone; one redemption link.
- `idempotency_keys`: unique `(operation, idempotency_key)`, fingerprint, result, response.
- `system_counters`: locked `successful_orders` sequence source.

All tables use InnoDB. The migration defines foreign keys, status columns, reporting/lookup indexes, and uniqueness constraints for the important invariants.

## Project structure

```text
backend/
    migrations/        schema
    seeds/             deterministic products
    src/
        services/      domain and transaction logic
        app.js          Express composition/error boundary
        config.js       environment parsing
        routes.js       HTTP contract
    test/               real MySQL integration/concurrency suite
frontend/
    src/                React demonstration UI
docker-compose.yml      isolated development and test MySQL
DECISIONS.md            engineering rationale and race analysis
REQUIREMENTS.md         final assignment audit
```

## Frontend walkthrough

The UI creates one cart on load. Its initialization guard remains safe when React StrictMode replays development effects. Add/update/remove items, enter an optional coupon, and check out. The displayed retry key is retained so pressing checkout again demonstrates safe replay; “New key” demonstrates a different logical request. The order panel shows immutable totals. The admin panel generates the next coupon, reconciles summary metrics, and lists successful immutable order snapshots with expandable item details.

Products, cart creation, and the combined admin data load have distinct loading, empty, success, and error states. Mutations use request-scoped pending states: add/update/remove remain scoped to the affected product, while cart creation, checkout, coupon generation, and report refresh disable only their relevant controls. Synchronous in-flight guards prevent duplicate clicks before React renders the disabled state. The UI does not impose a client timeout, so a slow or cold backend remains visibly pending instead of showing a premature empty state.

## Deployment

The production layout is Vercel (React/Vite) → Railway (Express) → Railway MySQL. The repository includes `vercel.json` and `railway.json` so the checked-in build, start, migration, and health-check behavior is reproducible.

### Railway backend and MySQL

1. Create a Railway project from this repository and add a MySQL service in the same project.
2. Configure the backend service with the variables below. Railway supplies `PORT`; do not set a fixed production port. Map the `DB_*` values to the MySQL service's `MYSQL*` variables using Railway reference variables so credentials are not copied into source.
3. Deploy. Railway runs `npm ci`, then `npm run migrate` as the pre-deploy command, starts `npm start --workspace backend`, and checks `/health`.
4. After the first successful migration, intentionally run `npm run seed` once in the backend service environment. The seed upserts the five demo product IDs and never truncates carts, orders, or coupons. Do not make it an automatic deploy step because rerunning it restores demo inventory.
5. Generate a public backend domain and verify `/health` and `/api/products` before configuring Vercel.

Railway backend variable names:

```text
NODE_ENV
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASSWORD
DB_POOL_MIN
DB_POOL_MAX
COUPON_ORDER_INTERVAL
COUPON_DISCOUNT_PERCENT
FRONTEND_ORIGIN
```

Use the Railway private-network MySQL host/port for `DB_HOST` and `DB_PORT`. `FRONTEND_ORIGIN` must be the exact final Vercel origin. Authentication for `/api/admin/*` is outside this assignment, so production access should be treated as demo-only until an auth layer is added.

### Vercel frontend

1. Import the same repository into Vercel. The root `vercel.json` runs the workspace production build and publishes `frontend/dist`.
2. Set `VITE_API_BASE_URL` to the public Railway backend URL plus `/api`, for example `https://service.example/api`, for Production (and Preview if desired).
3. Deploy, then update Railway's `FRONTEND_ORIGIN` to the exact Vercel production origin and redeploy the backend configuration.
4. Verify the Vercel page, API/CORS communication, cart mutations, checkout/replay, coupons, reports, and successful-order snapshots from the production browser.

`VITE_API_BASE_URL` is public configuration by design. Never expose database credentials or deployment tokens through a `VITE_*` variable. Provider credentials remain in their encrypted environment settings and all `.env` variants remain ignored by Git.

## Scope

Authentication, payment processing, tax/shipping, external inventory, and observability infrastructure are deferred. These omissions and their production implications are explicit in [DECISIONS.md](./DECISIONS.md).
