# Engineering Decisions

## 1. System invariants

| Invariant | Enforcement |
| --- | --- |
| Inventory never becomes negative | Product rows are locked with `SELECT ... FOR UPDATE`, availability is validated after the lock, and decrement happens in the same transaction. MySQL unsigned inventory is additional schema defense. |
| One cart creates at most one order | Checkout locks the cart and requires `OPEN`; `orders.cart_id` is unique; the cart becomes `CHECKED_OUT` in that transaction. |
| One logical checkout creates at most one order | A persistent row with unique `(operation, idempotency_key)` is claimed inside checkout. Its fingerprint and original completed response are locked/read on retry. |
| Retry never deducts inventory twice | A completed idempotency record is replayed before any inventory mutation. Its result commit is atomic with inventory and the order. |
| Each successful order has one race-safe sequence | The single `successful_orders` counter row is locked, incremented, and stored on an order in the checkout transaction; `orders.sequence_number` is unique. |
| Each milestone produces at most one coupon | Admin generation locks the counter and chooses the oldest unrewarded eligible milestone. `coupons.milestone_order_number` is unique. |
| A coupon funds at most one successful order | Checkout locks the coupon, requires `AVAILABLE`, and changes it to `REDEEMED` in the order transaction. `orders.coupon_id` and `coupons.redeemed_by_order_id` are nullable unique links. |
| Failed checkout consumes neither inventory nor coupon | Every relevant mutation uses one Knex transaction; every thrown validation/conflict causes `ROLLBACK`. |
| Historical financials remain immutable | `orders` stores coupon, gross, discount, and net snapshots; `order_items` stores product name, unit price, quantity, and line subtotal snapshots. Read APIs never reconstruct history from products. |
| Reports reconcile and do not mutate | SQL aggregates immutable orders/order-items and coupon status. The report service performs only `SELECT` queries. |

Application validation provides useful errors; transactions, locks, foreign keys, unsigned values, and unique constraints remain the authoritative multi-instance protections.

## 2. Selected semantics for ambiguities

- **Price changes:** cart retrieval displays the current product price. Checkout locks current product rows and takes the authoritative price snapshot then. Later changes never alter the order.
- **Inventory changes:** cart editing does not reserve inventory. Checkout validates after obtaining product locks; failure is explicit and atomic.
- **Adding an existing cart item:** sets the submitted quantity rather than incrementing it, making network retries of cart editing naturally repeatable.
- **Milestones:** successful orders receive consecutive sequence numbers. With interval 5, sequences 5, 10, 15, and so on make one coupon eligible. Failed transactions do not advance the counter.
- **Generation selection:** an admin request creates exactly the oldest eligible milestone without a coupon. If none exists, it returns `409 NO_ELIGIBLE_MILESTONE`; it does not return an earlier coupon as though it were newly generated.
- **Coupon applicability:** a generated coupon applies once to the whole gross merchandise amount of any later checkout. There is no customer identity or product restriction in this assignment.
- **Rounding:** discount uses integer round-half-up: `floor((grossPaise * percent + 50) / 100)`. Net is floored at zero.
- **Idempotency scope:** a key is global within `CART_CHECKOUT`. Its SHA-256 fingerprint covers cart ID and normalized coupon code. Same fingerprint replays; different cart/coupon returns predictable `409 IDEMPOTENCY_CONFLICT`.
- **Failed idempotent attempts:** their transaction (including the `PROCESSING` claim) rolls back, so the same key may retry after correcting transient business state. Only successful responses are replayed forever.

## Decision: MySQL/InnoDB for related state

**Context:** Inventory, cart state, order snapshots, coupon redemption, sequence assignment, and idempotency must change atomically.

**Options considered:** MySQL/InnoDB; MongoDB multi-document transactions plus conditional writes; application-level mutexes.

**Choice:** MySQL 8 with InnoDB.

**Why:** ACID transactions, row locks, foreign keys, unique constraints, and aggregation express the invariants directly and work across application instances. In-memory mutexes do not. MongoDB can implement this correctly, but a relational model and lock order are easier to inspect and defend here.

**Consequences:** Checkout holds short database transactions and can wait for competing rows. Operations must use a consistent lock order and a sufficiently sized connection pool.

## Decision: Explicit pessimistic row locking

**Context:** Two transactions can read the same apparent inventory or coupon availability.

**Options considered:** guarded atomic decrements, optimistic versions, and `SELECT ... FOR UPDATE`.

**Choice:** lock then validate, inside one transaction.

**Why:** The resulting code mirrors the interview invariant: after a transaction owns the row, the value it validates cannot be concurrently changed. It also yields detailed available/requested errors.

**Consequences:** Contention creates waiting. All product IDs are sorted ascending to reduce deadlocks, and known MySQL deadlock/lock-timeout transactions are retried at most twice.

## Decision: Persistent transactional idempotency

**Context:** Clients and proxies retry uncertain checkout responses; multiple backend instances cannot coordinate through memory.

**Options considered:** cart uniqueness alone, an in-memory key map, an idempotency table outside checkout, and a record within checkout.

**Choice:** persist key, request fingerprint, state, order, and response within the checkout transaction.

**Why:** The unique key serializes concurrent duplicates. The completed record cannot exist without the corresponding committed order/inventory state, and the exact response can be replayed.

**Consequences:** Completed keys require a retention policy in a long-running production system. This assignment intentionally keeps them indefinitely. A failed checkout does not persist its key.

## Decision: Immutable order snapshots

**Context:** Products can be renamed or repriced after purchase.

**Options considered:** join live product data during reads, store only price, or snapshot all explanatory values.

**Choice:** snapshot name, unit price, quantity, line subtotal, gross, coupon/code/percent, discount, and net.

**Why:** Orders and reports remain historically explainable and deterministic without depending on mutable catalog rows.

**Consequences:** Intentional data duplication and slightly larger rows. Snapshot data is written only during checkout.

## Decision: Locked system counter for order sequence

**Context:** Coupon eligibility requires a gap-free ordering of successful committed checkouts. `COUNT(*) + 1` races.

**Options considered:** order auto-increment IDs, `COUNT(*)`, and a named counter row.

**Choice:** lock and increment `system_counters.successful_orders` in checkout.

**Why:** Failed transactions roll the increment back, while concurrent successful transactions serialize and receive distinct consecutive sequence values. Auto-increment IDs can contain rollback gaps.

**Consequences:** The counter is a short serialization point for successful checkout. This is acceptable for the assignment and can be monitored/sharded by business sequence if extreme scale requires it.

## Decision: Database-protected milestone generation

**Context:** Two admins can request the same newly eligible reward.

**Options considered:** check-then-insert only; lock the counter plus unique milestone; pre-create milestone rows during checkout.

**Choice:** generation locks the order counter, finds the oldest gap, inserts it, and relies on unique milestone as final defense.

**Why:** It preserves explicit admin generation and makes duplicates impossible even if future code changes weaken serialization.

**Consequences:** One request succeeds; a simultaneous/duplicate request returns a clear no-eligible/conflict response.

## Decision: Integer paise and SQL-derived reports

**Context:** JavaScript floating point and mutable catalog data cannot authoritatively explain money.

**Options considered:** floating point, SQL `DECIMAL`, and integer smallest units.

**Choice:** nonnegative integer paise throughout authoritative storage/calculation; reports aggregate snapshots in SQL.

**Why:** Addition/multiplication and the documented rounding rule are exact for realistic order sizes. SQL aggregation minimizes reconciliation drift and data transfer.

**Consequences:** API clients format minor values for display. Production should impose a maximum order total below JavaScript's safe integer bound or migrate arithmetic to `BigInt`/decimal objects for exceptionally large values.

## Decision: Request-scoped loading and synchronous submission guards

**Context:** Production cold starts can keep requests pending for seconds, while React state updates alone do not prevent a second click in the same render frame.

**Options considered:** one page-wide loading overlay; disabled controls backed only by state; request-scoped state plus synchronous refs.

**Choice:** represent initial resource loading separately from successful-empty and error states, keep mutation feedback scoped to the affected control/item, and claim duplicate-sensitive actions synchronously with refs before awaiting the API.

**Why:** Slow responses remain understandable without hiding useful unrelated UI. The ref is updated immediately, closing the small window before React renders a disabled button. Backend checkout idempotency remains the authoritative correctness mechanism.

**Consequences:** The frontend maintains a small amount of explicit pending state. It deliberately has no artificial delay or short client timeout; genuine network errors use the existing structured error UI.

## 3. Concrete concurrency and transaction strategy

### Two customers buy the final unit

Both checkouts lock their cart, then request product locks in ascending ID order. One gets the limited product; the other waits. The first observes one, decrements to zero, creates its order, and commits. The waiter then observes zero after acquiring the lock and throws `INSUFFICIENT_INVENTORY`; its entire transaction rolls back. The integration test launches both with `Promise.all` and asserts one order plus inventory zero.

### Same checkout sent twice

Both attempt the same unique idempotency row. MySQL makes the second insert wait on the first transaction's uniqueness outcome. After the first commits `COMPLETED`, the second locks/reads that row, verifies the fingerprint, and returns its stored response before locking products. There is one order and one decrement. A later same-key retry behaves identically; a different fingerprint is rejected.

### Two users redeem the same coupon

Both lock their product rows and then the coupon. One obtains the coupon, observes `AVAILABLE`, and eventually marks it `REDEEMED` with its order in the same commit. The waiter then observes `REDEEMED` and rolls back. Exactly one order references that coupon; a failed later step would roll back redemption too.

### Two admins generate the same milestone

Generation locks the successful-order counter. One request chooses/inserts the oldest missing milestone and commits. The waiting request then sees the new coupon and no longer considers that milestone eligible. The unique milestone constraint remains a final safety net.

### Two carts list shared products in different orders

Cart item insertion order is ignored. Checkout extracts IDs, sorts ascending, and requests locks in that order. Thus `[1,2]` and `[2,1]` both acquire `1` before `2`, reducing circular waits. MySQL can still detect deadlocks involving other lock graphs, so only recognized deadlock/lock-timeout errors receive a bounded full-transaction retry.

## 4. Transaction boundary

A successful checkout atomically claims idempotency, locks/validates cart, locks/validates products, locks/validates coupon, decrements inventory, locks/increments order counter, inserts order and item snapshots, marks coupon redeemed, closes cart, and stores the completed idempotency response. No network/payment call occurs while locks are held.

The default MySQL isolation level is accepted; correctness depends on explicit record locks and unique constraints rather than unprotected snapshot reads. Production should set/verify the isolation level consistently and monitor lock waits/deadlocks.

## 5. Money and rounding

Currency is INR; `price_minor` and total columns contain integer paise. For percentage `p`:

```text
discountPaise = floor((grossPaise * p + 50) / 100)
netPaise = max(0, grossPaise - discountPaise)
```

This is round-half-up to the nearest paise for integer percentage coupons. A test proves ₹100.05 at 10% produces ₹10.01 discount, not a binary-float artifact.

## 6. Error model

Expected failures are `AppError` instances rendered as `{ error: { code, message, details } }`. Boundary syntax/shape uses 400; missing resources 404; state, concurrency, coupon, and idempotency conflicts 409; an empty but structurally valid cart uses 422. Unknown SQL/internal errors become a generic 500 without stack or SQL text. Constraint failures explicitly handled by a service are translated; final database constraints remain defense even when an unexpected constraint error is hidden as 500.

## 7. Implemented and deferred

Implemented: all specified product/cart/order/admin endpoints, current-price carts, checkout snapshots, inventory/coupon/counter locking, persisted idempotency, bounded deadlock retry, milestone generation, reconciliation report, Docker development/test MySQL, migration/seed, integration/concurrency tests, responsive React UI, environment configuration, lint/build scripts, and documentation.

Deliberately deferred production concerns: authentication/authorization (especially admin routes), real payment authorization/capture and reconciliation, tax/shipping, rate limiting, distributed tracing/metrics/alerts, external inventory integration, idempotency retention/cleanup, pagination, catalog administration, and queues for post-order work. Payment would require a state machine and careful design that avoids holding database locks over a remote provider call.

## 8. Production and multiple-instance evolution

All correctness coordination resides in shared MySQL locks and constraints, so horizontal Express instances do not create correctness gaps. A managed InnoDB service needs TLS, backups, point-in-time recovery, migration discipline, appropriate pool limits per instance, lock/deadlock metrics, slow-query analysis, and alerts on retry exhaustion. Existing indexes cover statuses, names, product/report joins, coupon lookup, and unique invariants. At higher volume, report replicas/materialized analytics may be used, but financial reconciliation must retain an authoritative snapshot-based path.

## 9. AI/Codex usage

Codex assisted with requirement decomposition, code drafting, test construction, and documentation. All generated work was inspected and validated with syntax checks, ESLint, production builds, a live API smoke workflow, and the real MySQL/InnoDB integration suite.

Genuine corrections during development included:

- The first generated root ESLint flat-config file used ESM `import` syntax with a `.js` extension while the root package was not marked as ESM. ESLint rejected it, so it was corrected to `eslint.config.mjs` and lint was rerun across backend and frontend.
- The first report query aliased `COUNT(*)` as `generated`, which MySQL parsed as a reserved word and returned 500. The real integration suite caught it; aliases were changed to unambiguous `*_count` names and all 14 tests then passed.
- Express 5 passes listen errors to the callback. The initial server callback ignored that argument and falsely logged success when port 5000 was occupied by AirTunes. Manual startup testing found it; startup now prints the actual error and exits nonzero.
- Vite initially searched for `.env` inside `frontend/`, so the UI ignored the shared root `VITE_API_BASE_URL` and fell back to port 5000. Browser testing exposed the resulting `Failed to fetch`; `vite.config.js` now explicitly uses the repository root as `envDir`.
- The first UI disabled checkout after success while simultaneously explaining that the same request could be retried. The dashboard test caught that contradiction; a checked-out cart with a known result now exposes an enabled `Retry checkout response` action and visibly reports `IDEMPOTENT REPLAY`.
- An early diagnosis attributed stalled container startup to a bind mount. A disposable `hello-world` test disproved that hypothesis by stalling identically. After the host daemon recovered, the unchanged named-volume MySQL services started and passed every database test. The two-service design remains for development/test isolation, not as a claimed daemon fix.

No private AI transcript is included.

## 10. If I had two more hours

1. Add a payment-intent state machine/outbox so external payment and local order commitment recover safely from every timeout boundary.
2. Add property-based/state-machine concurrency testing that runs larger randomized cart/product/coupon interleavings and verifies aggregate invariants.
3. Add migration CI against multiple supported MySQL 8 patch versions, plus lock-wait/deadlock telemetry assertions.
4. Define an idempotency expiration/archive policy with client ownership, rather than retaining keys indefinitely.
5. Add authentication and role enforcement for `/api/admin/*`, including audit events for coupon generation.
