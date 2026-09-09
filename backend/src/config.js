import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
dotenv.config({ path: path.join(root, process.env.NODE_ENV === 'test' ? '.env.test' : '.env') });

function positiveInteger(name, fallback) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

export const config = {
    env: process.env.NODE_ENV ?? 'development',
    port: positiveInteger('PORT', 5000),
    frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
    couponOrderInterval: positiveInteger('COUPON_ORDER_INTERVAL', 5),
    couponDiscountPercent: positiveInteger('COUPON_DISCOUNT_PERCENT', 10)
};

if (config.couponDiscountPercent > 100) {
    throw new Error('COUPON_DISCOUNT_PERCENT cannot exceed 100');
}

export const databaseConfig = {
    client: 'mysql2',
    connection: {
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: positiveInteger('DB_PORT', 3306),
        database: process.env.DB_NAME ?? (config.env === 'test' ? 'checkout_service_test' : 'checkout_service'),
        user: process.env.DB_USER ?? 'root',
        password: process.env.DB_PASSWORD ?? 'checkout_password',
        timezone: 'Z',
        supportBigNumbers: true,
        bigNumberStrings: false
    },
    pool: {
        min: Number(process.env.DB_POOL_MIN ?? 2),
        max: Number(process.env.DB_POOL_MAX ?? (config.env === 'test' ? 20 : 10))
    },
    migrations: { directory: path.join(root, 'backend/migrations') },
    seeds: { directory: path.join(root, 'backend/seeds') }
};
