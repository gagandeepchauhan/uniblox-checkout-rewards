import crypto from 'node:crypto';
import { db } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { getOrder } from './orders.js';

const operation = 'CART_CHECKOUT';
const retryableCodes = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

function fingerprint(cartId, couponCode) {
    return crypto.createHash('sha256').update(JSON.stringify({ cartId, couponCode: couponCode ?? null })).digest('hex');
}

function parseStoredJson(value) {
    return typeof value === 'string' ? JSON.parse(value) : value;
}

async function claimIdempotencyKey(trx, key, requestFingerprint) {
    try {
        await trx('idempotency_keys').insert({
            operation,
            idempotency_key: key,
            request_fingerprint: requestFingerprint,
            status: 'PROCESSING'
        });
        return null;
    } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        const existing = await trx('idempotency_keys')
            .where({ operation, idempotency_key: key })
            .forUpdate()
            .first();
        if (existing.request_fingerprint !== requestFingerprint) {
            throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was used for a different checkout request.');
        }
        if (existing.status === 'COMPLETED') return parseStoredJson(existing.response_body);
        throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'This checkout request is already in progress.');
    }
}

function calculateDiscount(grossTotalMinor, percent) {
    return Math.floor((grossTotalMinor * percent + 50) / 100);
}

async function checkoutTransaction(cartId, couponCode, key) {
    const requestFingerprint = fingerprint(cartId, couponCode);
    return db.transaction(async (trx) => {
        const replay = await claimIdempotencyKey(trx, key, requestFingerprint);
        if (replay) return { order: replay, replayed: true };

        const cart = await trx('carts').where({ id: cartId }).forUpdate().first();
        if (!cart) throw notFound('cart', cartId);
        if (cart.status !== 'OPEN') {
            throw new AppError(409, 'CART_ALREADY_CHECKED_OUT', 'This cart has already been checked out.', { cartId });
        }

        const cartItems = await trx('cart_items').where({ cart_id: cartId }).orderBy('product_id');
        if (!cartItems.length) throw new AppError(422, 'EMPTY_CART', 'An empty cart cannot be checked out.');

        const productIds = cartItems.map((item) => Number(item.product_id)).sort((a, b) => a - b);
        const products = await trx('products').whereIn('id', productIds).orderBy('id').forUpdate();
        const productById = new Map(products.map((product) => [Number(product.id), product]));
        const snapshots = cartItems.map((item) => {
            const product = productById.get(Number(item.product_id));
            if (!product) throw notFound('product', item.product_id);
            if (Number(product.inventory) < Number(item.quantity)) {
                throw new AppError(409, 'INSUFFICIENT_INVENTORY', 'Requested quantity is no longer available.', {
                    productId: Number(product.id),
                    requested: Number(item.quantity),
                    available: Number(product.inventory)
                });
            }
            const lineSubtotalMinor = Number(product.price_minor) * Number(item.quantity);
            return { product, quantity: Number(item.quantity), lineSubtotalMinor };
        });

        let coupon = null;
        if (couponCode) {
            coupon = await trx('coupons').where({ code: couponCode }).forUpdate().first();
            if (!coupon) throw new AppError(404, 'COUPON_NOT_FOUND', 'Coupon was not found.', { code: couponCode });
            if (coupon.status !== 'AVAILABLE') {
                throw new AppError(409, 'COUPON_UNAVAILABLE', 'Coupon has already been redeemed.', { code: couponCode });
            }
        }

        for (const snapshot of snapshots) {
            await trx('products').where({ id: snapshot.product.id }).update({
                inventory: trx.raw('inventory - ?', [snapshot.quantity]),
                updated_at: trx.fn.now()
            });
        }

        const counter = await trx('system_counters').where({ name: 'successful_orders' }).forUpdate().first();
        if (!counter) throw new Error('successful_orders counter is missing');
        const sequenceNumber = Number(counter.value) + 1;
        await trx('system_counters').where({ name: 'successful_orders' }).update({ value: sequenceNumber });

        const grossTotalMinor = snapshots.reduce((sum, item) => sum + item.lineSubtotalMinor, 0);
        const discountPercent = coupon ? Number(coupon.discount_percent) : 0;
        const discountMinor = calculateDiscount(grossTotalMinor, discountPercent);
        const netTotalMinor = Math.max(0, grossTotalMinor - discountMinor);
        const [orderId] = await trx('orders').insert({
            cart_id: cartId,
            sequence_number: sequenceNumber,
            coupon_id: coupon?.id ?? null,
            coupon_code: coupon?.code ?? null,
            discount_percent: coupon?.discount_percent ?? null,
            gross_total_minor: grossTotalMinor,
            discount_minor: discountMinor,
            net_total_minor: netTotalMinor
        });
        await trx('order_items').insert(snapshots.map((snapshot) => ({
            order_id: orderId,
            product_id: snapshot.product.id,
            product_name: snapshot.product.name,
            unit_price_minor: snapshot.product.price_minor,
            quantity: snapshot.quantity,
            line_subtotal_minor: snapshot.lineSubtotalMinor
        })));
        if (coupon) {
            await trx('coupons').where({ id: coupon.id }).update({
                status: 'REDEEMED',
                redeemed_by_order_id: orderId,
                redeemed_at: trx.fn.now(),
                updated_at: trx.fn.now()
            });
        }
        await trx('carts').where({ id: cartId }).update({ status: 'CHECKED_OUT', updated_at: trx.fn.now() });
        const orderResponse = await getOrder(orderId, trx);
        await trx('idempotency_keys').where({ operation, idempotency_key: key }).update({
            status: 'COMPLETED',
            order_id: orderId,
            response_body: JSON.stringify(orderResponse),
            updated_at: trx.fn.now()
        });
        return { order: orderResponse, replayed: false };
    });
}

export async function checkout(cartId, couponCode, key) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            return await checkoutTransaction(cartId, couponCode, key);
        } catch (error) {
            if (!retryableCodes.has(error.code) || attempt === 3) throw error;
        }
    }
}
