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

## Deployment

- Build `frontend/` on Vercel with `VITE_API_BASE_URL` set to the Render API URL.
- Run `npm start --workspace backend` on Render and set `FRONTEND_ORIGIN`, `PORT`, and managed-MySQL variables.
- Run `npm run migrate` as a controlled release step against the managed MySQL database.
- Do not automatically seed production. Invoke `npm run seed` only when the fixed demo catalog is intended.
- Use TLS options required by the selected MySQL provider. No application structure or business logic changes are necessary.

## Scope

Authentication, payment processing, tax/shipping, external inventory, and observability infrastructure are deferred. These omissions and their production implications are explicit in [DECISIONS.md](./DECISIONS.md).
