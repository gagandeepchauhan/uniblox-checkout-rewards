import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const formatMoney = (minor) => money.format(minor / 100);
const formatDateTime = (value) => dateTime.format(new Date(value));
const makeKey = () => globalThis.crypto?.randomUUID?.() ?? `checkout-${Date.now()}-${Math.random()}`;

function ErrorBanner({ error, clear }) {
    if (!error) return null;
    return (
        <div className="error" role="alert">
            <div><strong>{error.code}</strong><span>{error.message}</span></div>
            <button onClick={clear} aria-label="Dismiss error">×</button>
        </div>
    );
}

function ProductCard({ product, disabled, adding, add }) {
    const [quantity, setQuantity] = useState(1);
    return (
        <article className="product-card">
            <div className="product-art">{product.name.slice(0, 1)}</div>
            <div className="product-copy">
                <p className="eyebrow">{product.inventory} in stock</p>
                <h3>{product.name}</h3>
                <p className="price">{formatMoney(product.priceMinor)}</p>
            </div>
            <div className="add-row">
                <input
                    aria-label={`Quantity for ${product.name}`}
                    min="1"
                    max={Math.max(1, product.inventory)}
                    type="number"
                    value={quantity}
                    onChange={(event) => setQuantity(Number(event.target.value))}
                />
                <button disabled={disabled || adding || product.inventory === 0} onClick={() => add(product.id, quantity)}>
                    {adding ? 'Adding…' : 'Add'}
                </button>
            </div>
        </article>
    );
}

function CartPanel({ cart, creating, pendingActions, update, remove, checkout, couponCode, setCouponCode, checkoutKey, newCheckoutKey, loading, allowRetry }) {
    const canCheckout = (cart?.status === 'OPEN' && Boolean(cart?.items?.length))
        || (cart?.status === 'CHECKED_OUT' && allowRetry);
    return (
        <aside className="cart-panel">
            <div className="section-title">
                <div><p className="eyebrow">Cart #{cart?.id ?? '—'}</p><h2>Your cart</h2></div>
                <span className={`status ${cart?.status?.toLowerCase() ?? ''}`}>{creating ? 'CREATING' : cart?.status ?? 'UNAVAILABLE'}</span>
            </div>
            {creating && !cart && <div className="loading-card"><span className="spinner" />Creating your cart…</div>}
            {!creating && cart && !cart.items.length && <div className="empty">Choose something from the store to begin.</div>}
            {cart?.items?.map((item) => (
                <div className="cart-item" key={item.product.id}>
                    <div><strong>{item.product.name}</strong><span>{formatMoney(item.product.priceMinor)} each</span></div>
                    <div className="item-actions">
                        <input
                            aria-label={`Cart quantity for ${item.product.name}`}
                            min="1"
                            type="number"
                            value={item.quantity}
                            disabled={cart.status !== 'OPEN' || pendingActions[`update:${item.product.id}`] || pendingActions[`remove:${item.product.id}`]}
                            onChange={(event) => update(item.product.id, Number(event.target.value))}
                        />
                        <button className="link danger" disabled={cart.status !== 'OPEN' || pendingActions[`remove:${item.product.id}`] || pendingActions[`update:${item.product.id}`]} onClick={() => remove(item.product.id)}>
                            {pendingActions[`remove:${item.product.id}`] ? 'Removing…' : pendingActions[`update:${item.product.id}`] ? 'Updating…' : 'Remove'}
                        </button>
                    </div>
                    <strong>{formatMoney(item.lineSubtotalMinor)}</strong>
                </div>
            ))}
            <div className="total"><span>Gross total</span><strong>{formatMoney(cart?.grossTotalMinor ?? 0)}</strong></div>
            <label className="field">Coupon code (optional)
                <input value={couponCode} disabled={cart?.status !== 'OPEN'} onChange={(event) => setCouponCode(event.target.value)} placeholder="SAVE-000005-…" />
            </label>
            <button className="primary wide" disabled={loading || !canCheckout} onClick={checkout}>
                {loading ? 'Processing…' : cart?.status === 'CHECKED_OUT' ? 'Retry checkout response' : 'Checkout securely'}
            </button>
            <div className="key-row">
                <span>Retry key: <code>{checkoutKey.slice(0, 13)}…</code></span>
                <button className="link" onClick={newCheckoutKey}>New key</button>
            </div>
            <p className="hint">Press checkout again without changing the key to replay the original response safely.</p>
        </aside>
    );
}

function OrderResult({ order, replayed }) {
    if (!order) return null;
    return (
        <section className="order-result">
            <p className="eyebrow">{replayed ? 'Idempotent replay' : 'Order confirmed'}</p>
            <h2>Order #{order.id}</h2>
            <span className="sequence">Successful order {order.sequenceNumber}</span>
            {order.items.map((item) => <p key={item.productId}>{item.quantity} × {item.productName}<strong>{formatMoney(item.lineSubtotalMinor)}</strong></p>)}
            <hr />
            <p>Gross<strong>{formatMoney(order.grossTotalMinor)}</strong></p>
            <p>Discount<strong>− {formatMoney(order.discountMinor)}</strong></p>
            <p className="net">Paid<strong>{formatMoney(order.netTotalMinor)}</strong></p>
        </section>
    );
}

function Admin({ coupons, report, orders, loading, error, generating, generate, refresh }) {
    return (
        <section className="admin-section">
            <div className="admin-head"><div><p className="eyebrow">Administrative operations</p><h2>Rewards & reconciliation</h2></div><div><button disabled={generating} onClick={generate}>{generating ? 'Generating…' : 'Generate eligible coupon'}</button><button className="secondary" disabled={loading} onClick={refresh}>{loading ? 'Refreshing…' : 'Refresh report'}</button></div></div>
            {loading && !report && <div className="loading-card"><span className="spinner" />Loading report, coupons, and orders…</div>}
            {!loading && error && <p className="orders-error" role="alert">{error}</p>}
            {report && <div className="metrics">
                <article><span>Successful orders</span><strong>{report?.totalOrders ?? 0}</strong></article>
                <article><span>Gross revenue</span><strong>{formatMoney(report?.grossRevenueMinor ?? 0)}</strong></article>
                <article><span>Discounts</span><strong>{formatMoney(report?.totalDiscountsMinor ?? 0)}</strong></article>
                <article><span>Net revenue</span><strong>{formatMoney(report?.netRevenueMinor ?? 0)}</strong></article>
            </div>}
            {report && <div className="admin-grid">
                <div><h3>Coupons</h3>{!coupons.length && <p className="muted">No coupons generated yet.</p>}{coupons.map((coupon) => <div className="coupon" key={coupon.id}><code>{coupon.code}</code><span>{coupon.discountPercent}% · milestone {coupon.milestoneOrderNumber}</span><b className={coupon.status.toLowerCase()}>{coupon.status}</b></div>)}</div>
                <div><h3>Purchased by product</h3>{!report?.purchasedByProduct?.length && <p className="muted">No completed purchases yet.</p>}{report?.purchasedByProduct?.map((row) => <div className="report-row" key={row.productId}><span>{row.productName}</span><strong>{row.purchasedQuantity}</strong></div>)}</div>
            </div>}
            {report && <div className="orders-section">
                <h3>Successful Orders</h3>
                {!orders.length && <p className="muted">No successful orders yet.</p>}
                {Boolean(orders.length) && (
                    <div className="orders-table-wrap">
                        <table className="orders-table">
                            <thead><tr><th>Order</th><th>Placed</th><th>Items</th><th>Coupon</th><th>Gross</th><th>Discount</th><th>Final total</th></tr></thead>
                            <tbody>{orders.map((order) => (
                                <tr key={order.id}>
                                    <td><strong>#{order.id}</strong><span>Sequence {order.sequenceNumber} · Cart #{order.cartId}</span></td>
                                    <td>{formatDateTime(order.createdAt)}</td>
                                    <td>
                                        <details>
                                            <summary>{order.items.length} {order.items.length === 1 ? 'item' : 'items'}</summary>
                                            <div className="order-items">{order.items.map((item) => (
                                                <div key={item.productId}>
                                                    <strong>{item.productName}</strong>
                                                    <span>{item.quantity} × {formatMoney(item.unitPriceMinor)}</span>
                                                    <b>{formatMoney(item.lineSubtotalMinor)}</b>
                                                </div>
                                            ))}</div>
                                        </details>
                                    </td>
                                    <td>{order.coupon?.code ?? '—'}</td>
                                    <td>{formatMoney(order.grossTotalMinor)}</td>
                                    <td>− {formatMoney(order.discountMinor)}</td>
                                    <td><strong>{formatMoney(order.netTotalMinor)}</strong></td>
                                </tr>
                            ))}</tbody>
                        </table>
                    </div>
                )}
            </div>}
        </section>
    );
}

export function App() {
    const [products, setProducts] = useState([]);
    const [productsLoading, setProductsLoading] = useState(true);
    const [productsError, setProductsError] = useState(null);
    const [cart, setCart] = useState(null);
    const [cartCreating, setCartCreating] = useState(false);
    const [pendingCartActions, setPendingCartActions] = useState({});
    const [couponCode, setCouponCode] = useState('');
    const [checkoutKey, setCheckoutKey] = useState(makeKey);
    const [order, setOrder] = useState(null);
    const [replayed, setReplayed] = useState(false);
    const [coupons, setCoupons] = useState([]);
    const [report, setReport] = useState(null);
    const [orders, setOrders] = useState([]);
    const [adminLoading, setAdminLoading] = useState(true);
    const [adminError, setAdminError] = useState(null);
    const [couponGenerating, setCouponGenerating] = useState(false);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const initializationStarted = useRef(false);
    const cartCreationInFlight = useRef(false);
    const checkoutInFlight = useRef(false);
    const couponGenerationInFlight = useRef(false);
    const pendingCartActionsRef = useRef(new Set());

    const handleError = (caught) => setError({ code: caught.code, message: caught.message });
    const refreshAdmin = useCallback(async () => {
        setAdminLoading(true);
        setAdminError(null);
        try {
            const [couponResult, reportResult, orderResult] = await Promise.all([
                api('/admin/coupons'),
                api('/admin/report'),
                api('/admin/orders')
            ]);
            setCoupons(couponResult.data);
            setReport(reportResult.data);
            setOrders(orderResult.data);
        } catch (caught) {
            setAdminError(caught.message);
            throw caught;
        } finally {
            setAdminLoading(false);
        }
    }, []);
    const refreshProducts = useCallback(async () => {
        setProductsLoading(true);
        setProductsError(null);
        try {
            setProducts((await api('/products')).data);
        } catch (caught) {
            setProductsError(caught.message);
            throw caught;
        } finally {
            setProductsLoading(false);
        }
    }, []);
    const createNewCart = useCallback(async () => {
        if (cartCreationInFlight.current) return;
        cartCreationInFlight.current = true;
        setCartCreating(true);
        try {
            const result = await api('/carts', { method: 'POST' });
            setCart(result.data);
            setOrder(null);
            setCouponCode('');
            setCheckoutKey(makeKey());
        } finally {
            cartCreationInFlight.current = false;
            setCartCreating(false);
        }
    }, []);

    useEffect(() => {
        if (initializationStarted.current) return;
        initializationStarted.current = true;
        Promise.all([refreshProducts(), createNewCart(), refreshAdmin()]).catch(handleError);
    }, [createNewCart, refreshAdmin, refreshProducts]);

    async function mutateCart(path, method, body, actionKey) {
        if (pendingCartActionsRef.current.has(actionKey)) return;
        pendingCartActionsRef.current.add(actionKey);
        setPendingCartActions((current) => ({ ...current, [actionKey]: true }));
        try {
            setError(null);
            setCart((await api(path, { method, body: body && JSON.stringify(body) })).data);
        } catch (caught) {
            handleError(caught);
        } finally {
            pendingCartActionsRef.current.delete(actionKey);
            setPendingCartActions((current) => {
                const next = { ...current };
                delete next[actionKey];
                return next;
            });
        }
    }

    async function performCheckout() {
        if (checkoutInFlight.current) return;
        checkoutInFlight.current = true;
        try {
            setLoading(true);
            setError(null);
            const result = await api(`/carts/${cart.id}/checkout`, {
                method: 'POST',
                headers: { 'Idempotency-Key': checkoutKey },
                body: JSON.stringify(couponCode.trim() ? { couponCode: couponCode.trim() } : {})
            });
            setOrder(result.data);
            setReplayed(result.meta.replayed);
            setCart((await api(`/carts/${cart.id}`)).data);
            await Promise.all([refreshProducts(), refreshAdmin()]);
        } catch (caught) { handleError(caught); } finally {
            checkoutInFlight.current = false;
            setLoading(false);
        }
    }

    async function generateCoupon() {
        if (couponGenerationInFlight.current) return;
        couponGenerationInFlight.current = true;
        try {
            setCouponGenerating(true);
            setError(null);
            await api('/admin/coupons/generate', { method: 'POST' });
            await refreshAdmin();
        } catch (caught) { handleError(caught); } finally {
            couponGenerationInFlight.current = false;
            setCouponGenerating(false);
        }
    }

    return (
        <main>
            <header><div className="brand">U<span>niblox</span></div><button className="secondary" disabled={cartCreating} onClick={() => createNewCart().catch(handleError)}>{cartCreating ? 'Creating…' : 'New cart'}</button></header>
            <div className="hero"><p className="eyebrow">Reliable commerce, clearly demonstrated</p><h1>Checkout without the race conditions.</h1><p>Inventory, rewards, and retries remain correct—even when requests compete.</p></div>
            <ErrorBanner error={error} clear={() => setError(null)} />
            <div className="shop-layout">
                <section><div className="section-title"><div><p className="eyebrow">Seeded inventory</p><h2>Store</h2></div></div>{productsLoading && <div className="product-grid loading-products">{[1, 2, 3, 4].map((value) => <div className="product-skeleton" key={value} />)}</div>}{!productsLoading && productsError && <p className="orders-error" role="alert">{productsError}</p>}{!productsLoading && !productsError && !products.length && <div className="empty">No products are currently available.</div>}{!productsLoading && !productsError && Boolean(products.length) && <div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} disabled={cart?.status !== 'OPEN'} adding={Boolean(pendingCartActions[`add:${product.id}`])} add={(productId, quantity) => mutateCart(`/carts/${cart.id}/items`, 'POST', { productId, quantity }, `add:${productId}`)} />)}</div>}</section>
                <CartPanel cart={cart} creating={cartCreating} pendingActions={pendingCartActions} update={(id, quantity) => mutateCart(`/carts/${cart.id}/items/${id}`, 'PATCH', { quantity }, `update:${id}`)} remove={(id) => mutateCart(`/carts/${cart.id}/items/${id}`, 'DELETE', undefined, `remove:${id}`)} checkout={performCheckout} couponCode={couponCode} setCouponCode={setCouponCode} checkoutKey={checkoutKey} newCheckoutKey={() => setCheckoutKey(makeKey())} loading={loading} allowRetry={Boolean(order)} />
            </div>
            <OrderResult order={order} replayed={replayed} />
            <Admin coupons={coupons} report={report} orders={orders} loading={adminLoading} error={adminError} generating={couponGenerating} generate={generateCoupon} refresh={() => refreshAdmin().catch(handleError)} />
            <footer>All monetary values are stored and calculated as integer paise.</footer>
        </main>
    );
}
