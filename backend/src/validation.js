import { z } from 'zod';
import { AppError } from './errors.js';

export const idSchema = z.coerce.number().int().positive();
export const itemSchema = z.object({
    productId: idSchema,
    quantity: z.number().int().positive().max(100000)
}).strict();
export const quantitySchema = z.object({
    quantity: z.number().int().positive().max(100000)
}).strict();
export const checkoutSchema = z.object({
    couponCode: z.string().trim().min(3).max(64).optional()
}).strict();

export function parse(schema, value) {
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed.', {
            issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        });
    }
    return result.data;
}

export function parseId(value) {
    return parse(idSchema, value);
}

export function parseIdempotencyKey(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(value)) {
        throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8-128 safe characters.');
    }
    return value;
}
