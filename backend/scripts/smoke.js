const apiBaseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:5050/api';
const interval = Number(process.env.COUPON_ORDER_INTERVAL ?? 5);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function call(path, { method = 'GET', body, key, expected = [200] } = {}) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(key ? { 'Idempotency-Key': key } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const payload = await response.json();
    if (!expected.includes(response.status)) {
        throw new Error(`${method} ${path}: expected ${expected.join('/')}, received ${response.status} ${JSON.stringify(payload)}`);
    }
    return { status: response.status, ...payload };
}

async function createCart(productId, quantity = 1) {
    const created = await call('/carts', { method: 'POST', expected: [201] });
    if (productId) {
        await call(`/carts/${created.data.id}/items`, {
            method: 'POST',
            body: { productId, quantity },
            expected: [201]
        });
    }
    return created.data.id;
}

async function checkout(cartId, suffix, couponCode) {
    return call(`/carts/${cartId}/checkout`, {
        method: 'POST',
        key: `smoke-${runId}-${suffix}`,
        body: couponCode ? { couponCode } : {},
        expected: [201]
    });
}

async function main() {
    const productsBefore = (await call('/products')).data;
    const productOneBefore = productsBefore.find((product) => product.id === 1);

    const cartId = await createCart();
    await call(`/carts/${cartId}/items`, { method: 'POST', body: { productId: 1, quantity: 1 }, expected: [201] });
    await call(`/carts/${cartId}/items/1`, { method: 'PATCH', body: { quantity: 2 } });
    await call(`/carts/${cartId}/items/1`, { method: 'DELETE' });
    const prepared = await call(`/carts/${cartId}/items`, {
        method: 'POST',
        body: { productId: 1, quantity: 2 },
        expected: [201]
    });
    if (prepared.data.grossTotalMinor !== productOneBefore.priceMinor * 2) throw new Error('Cart total did not reconcile');

    const checkoutKey = `smoke-${runId}-primary`;
    const placed = await call(`/carts/${cartId}/checkout`, { method: 'POST', key: checkoutKey, body: {}, expected: [201] });
    const retrieved = await call(`/orders/${placed.data.id}`);
    const replayed = await call(`/carts/${cartId}/checkout`, { method: 'POST', key: checkoutKey, body: {}, expected: [200] });
    if (retrieved.data.id !== placed.data.id || replayed.data.id !== placed.data.id || !replayed.meta.replayed) {
        throw new Error('Order retrieval/idempotent replay did not return the original order');
    }
    const productOneAfter = (await call('/products')).data.find((product) => product.id === 1);
    if (productOneAfter.inventory !== productOneBefore.inventory - 2) throw new Error('Inventory was not deducted exactly once');

    const limited = (await call('/products')).data.find((product) => product.id === 5);
    const insufficientCart = await createCart(5, limited.inventory + 1);
    const insufficient = await call(`/carts/${insufficientCart}/checkout`, {
        method: 'POST',
        key: `smoke-${runId}-insufficient`,
        body: {},
        expected: [409]
    });
    if (insufficient.error.code !== 'INSUFFICIENT_INVENTORY') throw new Error('Expected insufficient inventory error');

    let report = (await call('/admin/report')).data;
    const ordersUntilMilestone = (interval - (report.totalOrders % interval)) % interval;
    for (let index = 0; index < ordersUntilMilestone; index += 1) {
        const milestoneCart = await createCart(2, 1);
        await checkout(milestoneCart, `milestone-${index}`);
    }
    const generated = await call('/admin/coupons/generate', { method: 'POST', expected: [201] });
    const duplicateGeneration = await call('/admin/coupons/generate', { method: 'POST', expected: [409] });
    if (duplicateGeneration.error.code !== 'NO_ELIGIBLE_MILESTONE') throw new Error('Duplicate generation was not rejected');

    const redemptionCart = await createCart(3, 1);
    const redeemedOrder = await checkout(redemptionCart, 'redeem', generated.data.code);
    if (redeemedOrder.data.coupon.code !== generated.data.code) throw new Error('Coupon was not applied');
    const secondRedemptionCart = await createCart(4, 1);
    const secondRedemption = await call(`/carts/${secondRedemptionCart}/checkout`, {
        method: 'POST',
        key: `smoke-${runId}-redeem-again`,
        body: { couponCode: generated.data.code },
        expected: [409]
    });
    if (secondRedemption.error.code !== 'COUPON_UNAVAILABLE') throw new Error('Second redemption was not rejected');

    report = (await call('/admin/report')).data;
    const repeatedReport = (await call('/admin/report')).data;
    if (JSON.stringify(report) !== JSON.stringify(repeatedReport)) throw new Error('Repeated report changed state');
    if (report.grossRevenueMinor - report.totalDiscountsMinor !== report.netRevenueMinor) {
        throw new Error('Report financial totals did not reconcile');
    }
    console.log(JSON.stringify({
        cartMutation: 'passed',
        orderId: placed.data.id,
        idempotentReplay: 'passed',
        inventoryDeductedOnce: 'passed',
        insufficientInventory: 'passed',
        milestoneCoupon: generated.data.code,
        duplicateGeneration: 'passed',
        oneTimeRedemption: 'passed',
        reportReadOnlyAndReconciled: 'passed',
        finalReport: report
    }, null, 4));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
