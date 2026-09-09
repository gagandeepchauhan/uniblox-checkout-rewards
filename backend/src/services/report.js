import { db } from '../db.js';

export async function getAdminReport() {
    const [financials, couponCounts, productRows] = await Promise.all([
        db('orders').select(
            db.raw('COUNT(*) AS total_orders'),
            db.raw('COALESCE(SUM(gross_total_minor), 0) AS gross_revenue_minor'),
            db.raw('COALESCE(SUM(discount_minor), 0) AS total_discounts_minor'),
            db.raw('COALESCE(SUM(net_total_minor), 0) AS net_revenue_minor')
        ).first(),
        db('coupons').select(
            db.raw('COUNT(*) AS generated_count'),
            db.raw("COALESCE(SUM(status = 'AVAILABLE'), 0) AS available_count"),
            db.raw("COALESCE(SUM(status = 'REDEEMED'), 0) AS redeemed_count")
        ).first(),
        db('order_items as oi')
            .select('oi.product_id', 'oi.product_name')
            .sum({ purchased_quantity: 'oi.quantity' })
            .groupBy('oi.product_id', 'oi.product_name')
            .orderBy('oi.product_id')
    ]);
    return {
        currency: 'INR',
        totalOrders: Number(financials.total_orders),
        grossRevenueMinor: Number(financials.gross_revenue_minor),
        totalDiscountsMinor: Number(financials.total_discounts_minor),
        netRevenueMinor: Number(financials.net_revenue_minor),
        coupons: {
            generated: Number(couponCounts.generated_count),
            available: Number(couponCounts.available_count),
            redeemed: Number(couponCounts.redeemed_count)
        },
        purchasedByProduct: productRows.map((row) => ({
            productId: Number(row.product_id),
            productName: row.product_name,
            purchasedQuantity: Number(row.purchased_quantity)
        }))
    };
}
