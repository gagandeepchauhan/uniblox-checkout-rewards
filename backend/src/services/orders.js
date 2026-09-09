import { db } from '../db.js';
import { notFound } from '../errors.js';
import { serializeOrder } from '../serializers.js';

export async function getOrder(orderId, executor = db) {
    const order = await executor('orders').where({ id: orderId }).first();
    if (!order) throw notFound('order', orderId);
    const items = await executor('order_items').where({ order_id: orderId }).orderBy('product_id');
    return serializeOrder(order, items);
}

export async function listOrders(executor = db) {
    const orders = await executor('orders').select('*').orderBy('sequence_number', 'desc');
    if (!orders.length) return [];

    const items = await executor('order_items')
        .whereIn('order_id', orders.map((order) => order.id))
        .orderBy(['order_id', 'product_id']);
    const itemsByOrder = new Map();
    for (const item of items) {
        const orderId = Number(item.order_id);
        if (!itemsByOrder.has(orderId)) itemsByOrder.set(orderId, []);
        itemsByOrder.get(orderId).push(item);
    }

    return orders.map((order) => serializeOrder(order, itemsByOrder.get(Number(order.id)) ?? []));
}
