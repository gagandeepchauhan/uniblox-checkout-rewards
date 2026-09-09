function integer(value) {
    return Number(value);
}

export function serializeProduct(row) {
    return {
        id: integer(row.id),
        name: row.name,
        priceMinor: integer(row.price_minor),
        inventory: integer(row.inventory),
        currency: 'INR'
    };
}

export function serializeCoupon(row) {
    return {
        id: integer(row.id),
        code: row.code,
        discountPercent: integer(row.discount_percent),
        milestoneOrderNumber: integer(row.milestone_order_number),
        status: row.status,
        redeemedByOrderId: row.redeemed_by_order_id == null ? null : integer(row.redeemed_by_order_id),
        redeemedAt: row.redeemed_at,
        createdAt: row.created_at
    };
}

export function serializeOrder(row, items = []) {
    return {
        id: integer(row.id),
        cartId: integer(row.cart_id),
        sequenceNumber: integer(row.sequence_number),
        items: items.map((item) => ({
            productId: integer(item.product_id),
            productName: item.product_name,
            unitPriceMinor: integer(item.unit_price_minor),
            quantity: integer(item.quantity),
            lineSubtotalMinor: integer(item.line_subtotal_minor)
        })),
        grossTotalMinor: integer(row.gross_total_minor),
        coupon: row.coupon_id == null ? null : {
            id: integer(row.coupon_id),
            code: row.coupon_code,
            discountPercent: integer(row.discount_percent)
        },
        discountMinor: integer(row.discount_minor),
        netTotalMinor: integer(row.net_total_minor),
        currency: 'INR',
        createdAt: row.created_at
    };
}
