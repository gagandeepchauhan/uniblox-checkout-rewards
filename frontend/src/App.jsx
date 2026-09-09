import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const formatMoney = (minor) => money.format(minor / 100);
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

function ProductCard({ product, disabled, add }) {
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
                <button disabled={disabled || product.inventory === 0} onClick={() => add(product.id, quantity)}>Add</button>
            </div>
        </article>
    );
}

function CartPanel({ cart, update, remove, checkout, couponCode, setCouponCode, checkoutKey, newCheckoutKey, loading, allowRetry }) {
    const canCheckout = (cart?.status === 'OPEN' && Boolean(cart?.items?.length))
        || (cart?.status === 'CHECKED_OUT' && allowRetry);
    return (
        <aside className="cart-panel">
            <div className="section-title">
                <div><p className="eyebrow">Cart #{cart?.id ?? '—'}</p><h2>Your cart</h2></div>
                <span className={`status ${cart?.status?.toLowerCase() ?? ''}`}>{cart?.status ?? 'CREATING'}</span>
            </div>
            {!cart?.items?.length && <div className="empty">Choose something from the store to begin.</div>}
            {cart?.items?.map((item) => (
                <div className="cart-item" key={item.product.id}>
                    <div><strong>{item.product.name}</strong><span>{formatMoney(item.product.priceMinor)} each</span></div>
                    <div className="item-actions">
                        <input
                            aria-label={`Cart quantity for ${item.product.name}`}
                            min="1"
                            type="number"
                            value={item.quantity}
                            disabled={cart.status !== 'OPEN'}
                            onChange={(event) => update(item.product.id, Number(event.target.value))}
                        />
                        <button className="link danger" disabled={cart.status !== 'OPEN'} onClick={() => remove(item.product.id)}>Remove</button>
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

function Admin({ coupons, report, generate, refresh }) {
    return (
        <section className="admin-section">
            <div className="admin-head"><div><p className="eyebrow">Administrative operations</p><h2>Rewards & reconciliation</h2></div><div><button onClick={generate}>Generate eligible coupon</button><button className="secondary" onClick={refresh}>Refresh report</button></div></div>
            <div className="metrics">
                <article><span>Successful orders</span><strong>{report?.totalOrders ?? 0}</strong></article>
                <article><span>Gross revenue</span><strong>{formatMoney(report?.grossRevenueMinor ?? 0)}</strong></article>
                <article><span>Discounts</span><strong>{formatMoney(report?.totalDiscountsMinor ?? 0)}</strong></article>
                <article><span>Net revenue</span><strong>{formatMoney(report?.netRevenueMinor ?? 0)}</strong></article>
            </div>
            <div className="admin-grid">
                <div><h3>Coupons</h3>{!coupons.length && <p className="muted">No coupons generated yet.</p>}{coupons.map((coupon) => <div className="coupon" key={coupon.id}><code>{coupon.code}</code><span>{coupon.discountPercent}% · milestone {coupon.milestoneOrderNumber}</span><b className={coupon.status.toLowerCase()}>{coupon.status}</b></div>)}</div>
                <div><h3>Purchased by product</h3>{!report?.purchasedByProduct?.length && <p className="muted">No completed purchases yet.</p>}{report?.purchasedByProduct?.map((row) => <div className="report-row" key={row.productId}><span>{row.productName}</span><strong>{row.purchasedQuantity}</strong></div>)}</div>
            </div>
        </section>
    );
}

export function App() {
    const [products, setProducts] = useState([]);
    const [cart, setCart] = useState(null);
    const [couponCode, setCouponCode] = useState('');
    const [checkoutKey, setCheckoutKey] = useState(makeKey);
    const [order, setOrder] = useState(null);
    const [replayed, setReplayed] = useState(false);
    const [coupons, setCoupons] = useState([]);
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleError = (caught) => setError({ code: caught.code, message: caught.message });
    const refreshAdmin = useCallback(async () => {
        const [couponResult, reportResult] = await Promise.all([api('/admin/coupons'), api('/admin/report')]);
        setCoupons(couponResult.data);
        setReport(reportResult.data);
    }, []);
    const refreshProducts = useCallback(async () => setProducts((await api('/products')).data), []);
    const createNewCart = useCallback(async () => {
        const result = await api('/carts', { method: 'POST' });
        setCart(result.data);
        setOrder(null);
        setCouponCode('');
        setCheckoutKey(makeKey());
    }, []);

    useEffect(() => {
        Promise.all([refreshProducts(), createNewCart(), refreshAdmin()]).catch(handleError);
    }, [createNewCart, refreshAdmin, refreshProducts]);

    async function mutateCart(path, method, body) {
        try {
            setError(null);
            setCart((await api(path, { method, body: body && JSON.stringify(body) })).data);
        } catch (caught) { handleError(caught); }
    }

    async function performCheckout() {
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
        } catch (caught) { handleError(caught); } finally { setLoading(false); }
    }

    async function generateCoupon() {
        try {
            setError(null);
            await api('/admin/coupons/generate', { method: 'POST' });
            await refreshAdmin();
        } catch (caught) { handleError(caught); }
    }

    return (
        <main>
            <header><div className="brand">U<span>niblox</span></div><button className="secondary" onClick={() => createNewCart().catch(handleError)}>New cart</button></header>
            <div className="hero"><p className="eyebrow">Reliable commerce, clearly demonstrated</p><h1>Checkout without the race conditions.</h1><p>Inventory, rewards, and retries remain correct—even when requests compete.</p></div>
            <ErrorBanner error={error} clear={() => setError(null)} />
            <div className="shop-layout">
                <section><div className="section-title"><div><p className="eyebrow">Seeded inventory</p><h2>Store</h2></div></div><div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} disabled={cart?.status !== 'OPEN'} add={(productId, quantity) => mutateCart(`/carts/${cart.id}/items`, 'POST', { productId, quantity })} />)}</div></section>
                <CartPanel cart={cart} update={(id, quantity) => mutateCart(`/carts/${cart.id}/items/${id}`, 'PATCH', { quantity })} remove={(id) => mutateCart(`/carts/${cart.id}/items/${id}`, 'DELETE')} checkout={performCheckout} couponCode={couponCode} setCouponCode={setCouponCode} checkoutKey={checkoutKey} newCheckoutKey={() => setCheckoutKey(makeKey())} loading={loading} allowRetry={Boolean(order)} />
            </div>
            <OrderResult order={order} replayed={replayed} />
            <Admin coupons={coupons} report={report} generate={generateCoupon} refresh={() => refreshAdmin().catch(handleError)} />
            <footer>All monetary values are stored and calculated as integer paise.</footer>
        </main>
    );
}
