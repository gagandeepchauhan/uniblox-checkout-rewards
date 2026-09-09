import { db } from '../db.js';
import { serializeProduct } from '../serializers.js';

export async function listProducts() {
    const rows = await db('products').select('*').orderBy('id');
    return rows.map(serializeProduct);
}
