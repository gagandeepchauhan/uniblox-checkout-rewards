const products = [
    { id: 1, name: 'Mechanical Keyboard', price_minor: 899900, inventory: 20 },
    { id: 2, name: 'Wireless Mouse', price_minor: 349900, inventory: 30 },
    { id: 3, name: 'USB-C Hub', price_minor: 499900, inventory: 15 },
    { id: 4, name: '4K Webcam', price_minor: 1299900, inventory: 8 },
    { id: 5, name: 'Limited Edition Desk Mat', price_minor: 199900, inventory: 1 }
];

export async function seed(knex) {
    await knex.transaction(async (trx) => {
        await trx('products').insert(products).onConflict('id').merge(['name', 'price_minor', 'inventory']);
        await trx('system_counters').insert({ name: 'successful_orders', value: 0 }).onConflict('name').ignore();
    });
}
