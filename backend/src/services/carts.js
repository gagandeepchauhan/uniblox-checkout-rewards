import { db } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { serializeProduct } from '../serializers.js';

async function requireOpenCart(trx, cartId, lock = false) {
    let query = trx('carts').where({ id: cartId });
    if (lock) query = query.forUpdate();
    const cart = await query.first();
    if (!cart) throw notFound('cart', cartId);
    if (cart.status !== 'OPEN') {
        throw new AppError(409, 'CART_NOT_OPEN', 'A checked-out cart cannot be modified.', { cartId });
    }
    return cart;
}

export async function createCart() {
    const [id] = await db('carts').insert({ status: 'OPEN' });
    return getCart(id);
}

export async function getCart(cartId, executor = db) {
    const cart = await executor('carts').where({ id: cartId }).first();
    if (!cart) throw notFound('cart', cartId);
    const rows = await executor('cart_items as ci')
        .join('products as p', 'p.id', 'ci.product_id')
        .where('ci.cart_id', cartId)
        .select('ci.quantity', 'p.*')
        .orderBy('p.id');
    const items = rows.map((row) => ({
        product: serializeProduct(row),
        quantity: Number(row.quantity),
        lineSubtotalMinor: Number(row.price_minor) * Number(row.quantity)
    }));
    return {
        id: Number(cart.id),
        status: cart.status,
        items,
        grossTotalMinor: items.reduce((sum, item) => sum + item.lineSubtotalMinor, 0),
        currency: 'INR',
        createdAt: cart.created_at,
        updatedAt: cart.updated_at
    };
}

export async function addCartItem(cartId, { productId, quantity }) {
    await db.transaction(async (trx) => {
        await requireOpenCart(trx, cartId, true);
        const product = await trx('products').where({ id: productId }).first();
        if (!product) throw notFound('product', productId);
        await trx('cart_items')
            .insert({ cart_id: cartId, product_id: productId, quantity })
            .onConflict(['cart_id', 'product_id'])
            .merge({ quantity, updated_at: trx.fn.now() });
    });
    return getCart(cartId);
}

export async function updateCartItem(cartId, productId, { quantity }) {
    await db.transaction(async (trx) => {
        await requireOpenCart(trx, cartId, true);
        const changed = await trx('cart_items').where({ cart_id: cartId, product_id: productId }).update({
            quantity,
            updated_at: trx.fn.now()
        });
        if (!changed) throw new AppError(404, 'CART_ITEM_NOT_FOUND', 'Cart item was not found.', { cartId, productId });
    });
    return getCart(cartId);
}

export async function removeCartItem(cartId, productId) {
    await db.transaction(async (trx) => {
        await requireOpenCart(trx, cartId, true);
        const changed = await trx('cart_items').where({ cart_id: cartId, product_id: productId }).delete();
        if (!changed) throw new AppError(404, 'CART_ITEM_NOT_FOUND', 'Cart item was not found.', { cartId, productId });
    });
    return getCart(cartId);
}
