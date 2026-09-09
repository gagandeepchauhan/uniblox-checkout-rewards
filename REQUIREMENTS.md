# Final Requirement Audit

## Backend and database

- [x] Node.js, Express, Knex, MySQL 8, InnoDB
- [x] Environment-driven database, CORS, port, reward interval, and percentage
- [x] Repeatable Docker development and isolated test databases
- [x] Migration for products, carts/items, orders/items, coupons, idempotency keys, and system counter
- [x] Foreign keys, useful indexes, explicit states, unique cart/order/sequence/code/milestone/idempotency constraints
- [x] Deterministic upsert seed with five products and a one-unit limited product
- [x] Integer INR paise throughout authoritative calculations and storage
- [x] Central structured errors and Zod API-boundary validation

## Domain behavior

- [x] Product list; create/retrieve/mutate cart; reject invalid IDs/quantities and closed-cart mutation
- [x] Checkout revalidates current prices/inventory and writes immutable snapshots
- [x] One transaction covers inventory, sequence, order, coupon, cart, and idempotency result
- [x] Product locks use deterministic ascending order
- [x] Persistent idempotency replays the exact successful result and rejects incompatible reuse
- [x] Successful-order counter is locked and incremented without `COUNT(*)` races
- [x] Oldest eligible milestone generation with unique database protection
- [x] Coupon row locking, one-time redemption, deterministic rounding, rollback on failure
- [x] Read-only report aggregates purchased quantities and immutable order financials
- [x] Administrative coupon list for demonstration

## Tests and demonstration

- [x] Integration suite implements valid/invalid cart, checkout snapshot, idempotency, rollback, reward, rounding, and report cases
- [x] Suite issues genuine `Promise.all` races for same-key checkout, final-unit inventory, coupon generation, and redemption, then queries final state
- [x] Runtime integration verification: both MySQL services healthy; fresh development/test migrations passed; development seed passed; all 14 integration tests passed against MySQL/InnoDB
- [x] Deterministic live API smoke workflow passed cart mutation, checkout/retrieval/replay, exact-once inventory, insufficient inventory, milestone/duplicate generation, redemption/reuse rejection, and stable reconciliation
- [x] Frontend development server, backend CORS, live five-product response, lint, production build, and production dependency audit verified
- [x] React store/cart/checkout/retry/order/admin/error surface
- [x] Environment-driven frontend API and production build script
- [x] Complete README/API/setup/deployment documentation
- [x] Engineering decisions, invariants, race explanations, AI usage, deferrals, and next investments

## Deliberate omissions

Authentication, payments, tax/shipping, rate limiting, distributed observability, external inventory, and large-scale analytics are outside the assignment scope and described with production implications in `DECISIONS.md`.
