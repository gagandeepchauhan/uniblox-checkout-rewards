import crypto from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { serializeCoupon } from '../serializers.js';

export async function generateCoupon() {
    try {
        return await db.transaction(async (trx) => {
            const counter = await trx('system_counters').where({ name: 'successful_orders' }).forUpdate().first();
            const totalOrders = Number(counter.value);
            const generated = await trx('coupons').select('milestone_order_number');
            const generatedMilestones = new Set(generated.map((row) => Number(row.milestone_order_number)));
            let milestone = null;
            for (let value = config.couponOrderInterval; value <= totalOrders; value += config.couponOrderInterval) {
                if (!generatedMilestones.has(value)) {
                    milestone = value;
                    break;
                }
            }
            if (!milestone) {
                throw new AppError(409, 'NO_ELIGIBLE_MILESTONE', 'No unrewarded order milestone is currently eligible.', {
                    successfulOrders: totalOrders,
                    interval: config.couponOrderInterval
                });
            }
            const code = `SAVE-${String(milestone).padStart(6, '0')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            const [id] = await trx('coupons').insert({
                code,
                discount_percent: config.couponDiscountPercent,
                milestone_order_number: milestone,
                status: 'AVAILABLE'
            });
            return serializeCoupon(await trx('coupons').where({ id }).first());
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            throw new AppError(409, 'MILESTONE_ALREADY_REWARDED', 'The eligible milestone already has a coupon.');
        }
        throw error;
    }
}

export async function listCoupons() {
    const coupons = await db('coupons').select('*').orderBy('milestone_order_number');
    return coupons.map(serializeCoupon);
}
