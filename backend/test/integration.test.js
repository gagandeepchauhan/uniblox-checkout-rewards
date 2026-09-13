import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/db.js';

const app = createApp();
const products = [
    { id: 1, name: 'Mechanical Keyboard', price_minor: 899900, inventory: 20 },
    { id: 2, name: 'Wireless Mouse', price_minor: 349900, inventory: 30 },
    { id: 3, name: 'USB-C Hub', price_minor: 499900, inventory: 15 },
    { id: 4, name: '4K Webcam', price_minor: 1299900, inventory: 8 },
    { id: 5, name: 'Limited Edition Desk Mat', price_minor: 199900, inventory: 1 }
];

async function resetDatabase() {
    await db.raw('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of ['idempotency_keys', 'coupons', 'order_items', 'orders', 'cart_items', 'carts', 'products', 'system_counters']) {
        await db.raw('TRUNCATE TABLE ??', [table]);
    }
    await db.raw('SET FOREIGN_KEY_CHECKS = 1');
    await db('products').insert(products);
    await db('system_counters').insert({ name: 'successful_orders', value: 0 });
}

async function createCart(productId = 1, quantity = 1) {
    const created = await request(app).post('/api/carts').expect(201);
    const cartId = created.body.data.id;
    if (productId) {
        await request(app).post(`/api/carts/${cartId}/items`).send({ productId, quantity }).expect(201);
    }
    return cartId;
}

async function checkoutCart(cartId, key, body = {}) {
    return request(app).post(`/api/carts/${cartId}/checkout`).set('Idempotency-Key', key).send(body);
}

async function createSuccessfulOrders(count) {
    const orders = [];
    for (let index = 0; index < count; index += 1) {
        const cartId = await createCart(2, 1);
        const response = await checkoutCart(cartId, `milestone-${index}-key`);
        expect(response.status).toBe(201);
        orders.push(response.body.data);
    }
    return orders;
}

async function createAvailableCoupon() {
    await createSuccessfulOrders(5);
    const generated = await request(app).post('/api/admin/coupons/generate').expect(201);
    return generated.body.data;
}

beforeAll(async () => {
    await db.migrate.latest();
});

beforeEach(resetDatabase);

afterAll(async () => {
    await db.destroy();
});

describe('products and carts', () => {
    it('creates a cart and supports add, update, remove, and current-price totals', async () => {
        const cartId = await createCart(null);
        const added = await request(app).post(`/api/carts/${cartId}/items`).send({ productId: 1, quantity: 2 }).expect(201);
        expect(added.body.data.grossTotalMinor).toBe(1799800);
        const updated = await request(app).patch(`/api/carts/${cartId}/items/1`).send({ quantity: 3 }).expect(200);
        expect(updated.body.data.items[0].quantity).toBe(3);
        const removed = await request(app).delete(`/api/carts/${cartId}/items/1`).expect(200);
        expect(removed.body.data.items).toEqual([]);
    });

    it('rejects malformed quantities and nonexistent products explicitly', async () => {
        const cartId = await createCart(null);
        const invalid = await request(app).post(`/api/carts/${cartId}/items`).send({ productId: 1, quantity: 0 }).expect(400);
        expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
        const missing = await request(app).post(`/api/carts/${cartId}/items`).send({ productId: 9999, quantity: 1 }).expect(404);
        expect(missing.body.error.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('rejects add and update quantities above the current inventory', async () => {
        const cartId = await createCart(null);
        const unavailableAdd = await request(app).post(`/api/carts/${cartId}/items`).send({ productId: 5, quantity: 2 }).expect(409);
        expect(unavailableAdd.body.error.code).toBe('INSUFFICIENT_INVENTORY');
        await request(app).post(`/api/carts/${cartId}/items`).send({ productId: 5, quantity: 1 }).expect(201);
        const unavailableUpdate = await request(app).patch(`/api/carts/${cartId}/items/5`).send({ quantity: 2 }).expect(409);
        expect(unavailableUpdate.body.error.code).toBe('INSUFFICIENT_INVENTORY');
    });
});

describe('transactional checkout and idempotency', () => {
    it('checks out successfully with immutable line and price snapshots', async () => {
        const cartId = await createCart(1, 2);
        const completed = await checkoutCart(cartId, 'successful-checkout-key');
        expect(completed.status).toBe(201);
        expect(completed.body.data).toMatchObject({ sequenceNumber: 1, grossTotalMinor: 1799800, netTotalMinor: 1799800 });
        await db('products').where({ id: 1 }).update({ name: 'Renamed', price_minor: 1 });
        const stored = await request(app).get(`/api/orders/${completed.body.data.id}`).expect(200);
        expect(stored.body.data.items[0]).toMatchObject({ productName: 'Mechanical Keyboard', unitPriceMinor: 899900 });
    });

    it('replays the same key and never deducts inventory or creates an order twice', async () => {
        const cartId = await createCart(1, 2);
        const first = await checkoutCart(cartId, 'repeat-checkout-key');
        const second = await checkoutCart(cartId, 'repeat-checkout-key');
        expect(first.status).toBe(201);
        expect(second.status).toBe(200);
        expect(second.body.meta.replayed).toBe(true);
        expect(second.body.data.id).toBe(first.body.data.id);
        expect(Number((await db('products').where({ id: 1 }).first()).inventory)).toBe(18);
        expect(Number((await db('orders').count({ count: '*' }).first()).count)).toBe(1);
    });

    it('rejects a second checkout with a different key and incompatible key reuse', async () => {
        const firstCart = await createCart(1, 1);
        await checkoutCart(firstCart, 'one-logical-request');
        const duplicateCart = await checkoutCart(firstCart, 'different-request-key');
        expect(duplicateCart.status).toBe(409);
        expect(duplicateCart.body.error.code).toBe('CART_ALREADY_CHECKED_OUT');
        const secondCart = await createCart(2, 1);
        const conflict = await checkoutCart(secondCart, 'one-logical-request');
        expect(conflict.status).toBe(409);
        expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('handles genuinely concurrent duplicate requests as one logical checkout', async () => {
        const cartId = await createCart(1, 2);
        const responses = await Promise.all([
            checkoutCart(cartId, 'concurrent-same-key'),
            checkoutCart(cartId, 'concurrent-same-key')
        ]);
        expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
        expect(new Set(responses.map((response) => response.body.data.id)).size).toBe(1);
        expect(Number((await db('products').where({ id: 1 }).first()).inventory)).toBe(18);
    });

    it('allows only one competing buyer to purchase the final inventory unit', async () => {
        const [cartA, cartB] = await Promise.all([createCart(5, 1), createCart(5, 1)]);
        const responses = await Promise.all([
            checkoutCart(cartA, 'final-unit-buyer-a'),
            checkoutCart(cartB, 'final-unit-buyer-b')
        ]);
        expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
        expect(responses.find((response) => response.status === 409).body.error.code).toBe('INSUFFICIENT_INVENTORY');
        expect(Number((await db('products').where({ id: 5 }).first()).inventory)).toBe(0);
        expect(Number((await db('orders').count({ count: '*' }).first()).count)).toBe(1);
    });

    it('rolls back every inventory change when any cart line is unavailable', async () => {
        const cartId = await createCart(1, 2);
        await request(app).post(`/api/carts/${cartId}/items`).send({ productId: 5, quantity: 1 }).expect(201);
        await db('products').where({ id: 5 }).update({ inventory: 0 });
        const failed = await checkoutCart(cartId, 'atomic-failure-key');
        expect(failed.status).toBe(409);
        expect(Number((await db('products').where({ id: 1 }).first()).inventory)).toBe(20);
        expect(Number((await db('products').where({ id: 5 }).first()).inventory)).toBe(0);
        expect(Number((await db('orders').count({ count: '*' }).first()).count)).toBe(0);
    });
});

describe('coupon milestones and redemption', () => {
    it('generates only after an eligible milestone and only once per milestone', async () => {
        const early = await request(app).post('/api/admin/coupons/generate').expect(409);
        expect(early.body.error.code).toBe('NO_ELIGIBLE_MILESTONE');
        await createSuccessfulOrders(5);
        const generated = await request(app).post('/api/admin/coupons/generate').expect(201);
        expect(generated.body.data).toMatchObject({ milestoneOrderNumber: 5, status: 'AVAILABLE', discountPercent: 10 });
        await request(app).post('/api/admin/coupons/generate').expect(409);
        expect(Number((await db('coupons').count({ count: '*' }).first()).count)).toBe(1);
    });

    it('serializes concurrent generation and creates at most one milestone coupon', async () => {
        await createSuccessfulOrders(5);
        const responses = await Promise.all([
            request(app).post('/api/admin/coupons/generate'),
            request(app).post('/api/admin/coupons/generate')
        ]);
        expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
        expect(Number((await db('coupons').where({ milestone_order_number: 5 }).count({ count: '*' }).first()).count)).toBe(1);
    });

    it('redeems a coupon once and applies deterministic round-half-up integer arithmetic', async () => {
        const coupon = await createAvailableCoupon();
        await db('products').where({ id: 1 }).update({ price_minor: 10005 });
        const cartId = await createCart(1, 1);
        const result = await checkoutCart(cartId, 'rounding-checkout-key', { couponCode: coupon.code });
        expect(result.status).toBe(201);
        expect(result.body.data).toMatchObject({ grossTotalMinor: 10005, discountMinor: 1001, netTotalMinor: 9004 });
        const storedCoupon = await db('coupons').where({ id: coupon.id }).first();
        expect(storedCoupon.status).toBe('REDEEMED');
        expect(Number(storedCoupon.redeemed_by_order_id)).toBe(result.body.data.id);
    });

    it('allows exactly one of two concurrent checkouts to redeem the same coupon', async () => {
        const coupon = await createAvailableCoupon();
        const [cartA, cartB] = await Promise.all([createCart(1, 1), createCart(2, 1)]);
        const responses = await Promise.all([
            checkoutCart(cartA, 'coupon-race-checkout-a', { couponCode: coupon.code }),
            checkoutCart(cartB, 'coupon-race-checkout-b', { couponCode: coupon.code })
        ]);
        expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
        expect(responses.find((response) => response.status === 409).body.error.code).toBe('COUPON_UNAVAILABLE');
        expect(Number((await db('orders').whereNotNull('coupon_id').count({ count: '*' }).first()).count)).toBe(1);
    });

    it('does not consume a coupon when checkout fails', async () => {
        const coupon = await createAvailableCoupon();
        const cartId = await createCart(5, 1);
        await db('products').where({ id: 5 }).update({ inventory: 0 });
        const failed = await checkoutCart(cartId, 'failed-coupon-checkout', { couponCode: coupon.code });
        expect(failed.status).toBe(409);
        expect((await db('coupons').where({ id: coupon.id }).first()).status).toBe('AVAILABLE');
    });
});

describe('administrative reporting', () => {
    it('lists only successful orders newest first using immutable snapshots without mutating state', async () => {
        await createCart(3, 1);
        const firstCart = await createCart(1, 2);
        const firstOrder = await checkoutCart(firstCart, 'admin-order-list-first');
        await db('products').where({ id: 1 }).update({ name: 'Changed after checkout', price_minor: 1 });
        const secondCart = await createCart(2, 1);
        const secondOrder = await checkoutCart(secondCart, 'admin-order-list-second');
        const stateBefore = {
            orders: Number((await db('orders').count({ count: '*' }).first()).count),
            carts: Number((await db('carts').count({ count: '*' }).first()).count),
            inventory: Number((await db('products').where({ id: 2 }).first()).inventory)
        };

        const firstRead = await request(app).get('/api/admin/orders').expect(200);
        const secondRead = await request(app).get('/api/admin/orders').expect(200);

        expect(secondRead.body).toEqual(firstRead.body);
        expect(firstRead.body.data.map((order) => order.id)).toEqual([
            secondOrder.body.data.id,
            firstOrder.body.data.id
        ]);
        expect(firstRead.body.data[1]).toMatchObject({
            cartId: firstCart,
            sequenceNumber: 1,
            grossTotalMinor: 1799800,
            discountMinor: 0,
            netTotalMinor: 1799800,
            items: [{
                productId: 1,
                productName: 'Mechanical Keyboard',
                unitPriceMinor: 899900,
                quantity: 2,
                lineSubtotalMinor: 1799800
            }]
        });
        expect({
            orders: Number((await db('orders').count({ count: '*' }).first()).count),
            carts: Number((await db('carts').count({ count: '*' }).first()).count),
            inventory: Number((await db('products').where({ id: 2 }).first()).inventory)
        }).toEqual(stateBefore);
    });

    it('reconciles immutable order and coupon state and is read-only', async () => {
        const coupon = await createAvailableCoupon();
        const cartId = await createCart(1, 2);
        await checkoutCart(cartId, 'reported-coupon-order', { couponCode: coupon.code });
        const before = await request(app).get('/api/admin/report').expect(200);
        const after = await request(app).get('/api/admin/report').expect(200);
        expect(after.body).toEqual(before.body);
        const report = before.body.data;
        expect(report.totalOrders).toBe(6);
        expect(report.grossRevenueMinor).toBe(5 * 349900 + 2 * 899900);
        expect(report.totalDiscountsMinor).toBe(179980);
        expect(report.netRevenueMinor).toBe(report.grossRevenueMinor - report.totalDiscountsMinor);
        expect(report.coupons).toEqual({ generated: 1, available: 0, redeemed: 1 });
        expect(report.purchasedByProduct).toEqual(expect.arrayContaining([
            expect.objectContaining({ productId: 1, purchasedQuantity: 2 }),
            expect.objectContaining({ productId: 2, purchasedQuantity: 5 })
        ]));
    });
});
