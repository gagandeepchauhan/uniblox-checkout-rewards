import { Router } from 'express';
import { parse, parseId, parseIdempotencyKey, itemSchema, quantitySchema, checkoutSchema } from './validation.js';
import { listProducts } from './services/products.js';
import { createCart, getCart, addCartItem, updateCartItem, removeCartItem } from './services/carts.js';
import { checkout } from './services/checkout.js';
import { getOrder } from './services/orders.js';
import { generateCoupon, listCoupons } from './services/coupons.js';
import { getAdminReport } from './services/report.js';

export const apiRouter = Router();
const asyncRoute = (handler) => (request, response, next) => Promise.resolve(handler(request, response)).catch(next);

apiRouter.get('/products', asyncRoute(async (_request, response) => {
    response.json({ data: await listProducts() });
}));

apiRouter.post('/carts', asyncRoute(async (_request, response) => {
    response.status(201).json({ data: await createCart() });
}));

apiRouter.get('/carts/:cartId', asyncRoute(async (request, response) => {
    response.json({ data: await getCart(parseId(request.params.cartId)) });
}));

apiRouter.post('/carts/:cartId/items', asyncRoute(async (request, response) => {
    response.status(201).json({ data: await addCartItem(parseId(request.params.cartId), parse(itemSchema, request.body)) });
}));

apiRouter.patch('/carts/:cartId/items/:productId', asyncRoute(async (request, response) => {
    response.json({ data: await updateCartItem(
        parseId(request.params.cartId),
        parseId(request.params.productId),
        parse(quantitySchema, request.body)
    ) });
}));

apiRouter.delete('/carts/:cartId/items/:productId', asyncRoute(async (request, response) => {
    response.json({ data: await removeCartItem(parseId(request.params.cartId), parseId(request.params.productId)) });
}));

apiRouter.post('/carts/:cartId/checkout', asyncRoute(async (request, response) => {
    const cartId = parseId(request.params.cartId);
    const { couponCode } = parse(checkoutSchema, request.body ?? {});
    const key = parseIdempotencyKey(request.get('Idempotency-Key'));
    const result = await checkout(cartId, couponCode?.toUpperCase(), key);
    response.status(result.replayed ? 200 : 201).json({ data: result.order, meta: { replayed: result.replayed } });
}));

apiRouter.get('/orders/:orderId', asyncRoute(async (request, response) => {
    response.json({ data: await getOrder(parseId(request.params.orderId)) });
}));

apiRouter.post('/admin/coupons/generate', asyncRoute(async (_request, response) => {
    response.status(201).json({ data: await generateCoupon() });
}));

apiRouter.get('/admin/coupons', asyncRoute(async (_request, response) => {
    response.json({ data: await listCoupons() });
}));

apiRouter.get('/admin/report', asyncRoute(async (_request, response) => {
    response.json({ data: await getAdminReport() });
}));
