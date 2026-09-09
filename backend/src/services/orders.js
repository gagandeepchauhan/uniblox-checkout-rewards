import { db } from '../db.js';
import { notFound } from '../errors.js';
import { serializeOrder } from '../serializers.js';

export async function getOrder(orderId, executor = db) {
    const order = await executor('orders').where({ id: orderId }).first();
    if (!order) throw notFound('order', orderId);
    const items = await executor('order_items').where({ order_id: orderId }).orderBy('product_id');
    return serializeOrder(order, items);
}
