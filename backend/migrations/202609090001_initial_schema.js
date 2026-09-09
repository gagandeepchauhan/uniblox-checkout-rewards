export async function up(knex) {
    await knex.schema.createTable('products', (table) => {
        table.bigIncrements('id').primary();
        table.string('name', 160).notNullable();
        table.bigInteger('price_minor').unsigned().notNullable();
        table.integer('inventory').unsigned().notNullable();
        table.timestamps(true, true);
        table.index('name');
        table.engine('InnoDB');
    });

    await knex.schema.createTable('carts', (table) => {
        table.bigIncrements('id').primary();
        table.enu('status', ['OPEN', 'CHECKED_OUT'], { useNative: false, enumName: 'cart_status' }).notNullable().defaultTo('OPEN');
        table.timestamps(true, true);
        table.index('status');
        table.engine('InnoDB');
    });

    await knex.schema.createTable('cart_items', (table) => {
        table.bigInteger('cart_id').unsigned().notNullable().references('id').inTable('carts').onDelete('CASCADE');
        table.bigInteger('product_id').unsigned().notNullable().references('id').inTable('products').onDelete('RESTRICT');
        table.integer('quantity').unsigned().notNullable();
        table.timestamps(true, true);
        table.primary(['cart_id', 'product_id']);
        table.engine('InnoDB');
    });

    await knex.schema.createTable('system_counters', (table) => {
        table.string('name', 80).primary();
        table.bigInteger('value').unsigned().notNullable().defaultTo(0);
        table.engine('InnoDB');
    });

    await knex.schema.createTable('orders', (table) => {
        table.bigIncrements('id').primary();
        table.bigInteger('cart_id').unsigned().notNullable().references('id').inTable('carts').onDelete('RESTRICT');
        table.bigInteger('sequence_number').unsigned().notNullable();
        table.bigInteger('coupon_id').unsigned().nullable();
        table.string('coupon_code', 64).nullable();
        table.integer('discount_percent').unsigned().nullable();
        table.bigInteger('gross_total_minor').unsigned().notNullable();
        table.bigInteger('discount_minor').unsigned().notNullable().defaultTo(0);
        table.bigInteger('net_total_minor').unsigned().notNullable();
        table.timestamps(true, true);
        table.unique('cart_id');
        table.unique('sequence_number');
        table.unique('coupon_id');
        table.engine('InnoDB');
    });

    await knex.schema.createTable('order_items', (table) => {
        table.bigIncrements('id').primary();
        table.bigInteger('order_id').unsigned().notNullable().references('id').inTable('orders').onDelete('RESTRICT');
        table.bigInteger('product_id').unsigned().notNullable().references('id').inTable('products').onDelete('RESTRICT');
        table.string('product_name', 160).notNullable();
        table.bigInteger('unit_price_minor').unsigned().notNullable();
        table.integer('quantity').unsigned().notNullable();
        table.bigInteger('line_subtotal_minor').unsigned().notNullable();
        table.unique(['order_id', 'product_id']);
        table.index('product_id');
        table.engine('InnoDB');
    });

    await knex.schema.createTable('coupons', (table) => {
        table.bigIncrements('id').primary();
        table.string('code', 64).notNullable().unique();
        table.integer('discount_percent').unsigned().notNullable();
        table.bigInteger('milestone_order_number').unsigned().notNullable().unique();
        table.enu('status', ['AVAILABLE', 'REDEEMED'], { useNative: false, enumName: 'coupon_status' }).notNullable().defaultTo('AVAILABLE');
        table.bigInteger('redeemed_by_order_id').unsigned().nullable().unique().references('id').inTable('orders').onDelete('RESTRICT');
        table.timestamp('redeemed_at').nullable();
        table.timestamps(true, true);
        table.index('status');
        table.engine('InnoDB');
    });

    await knex.schema.alterTable('orders', (table) => {
        table.foreign('coupon_id').references('id').inTable('coupons').onDelete('RESTRICT');
    });

    await knex.schema.createTable('idempotency_keys', (table) => {
        table.bigIncrements('id').primary();
        table.string('operation', 80).notNullable();
        table.string('idempotency_key', 128).notNullable();
        table.string('request_fingerprint', 64).notNullable();
        table.enu('status', ['PROCESSING', 'COMPLETED'], { useNative: false, enumName: 'idempotency_status' }).notNullable();
        table.bigInteger('order_id').unsigned().nullable().references('id').inTable('orders').onDelete('RESTRICT');
        table.json('response_body').nullable();
        table.timestamps(true, true);
        table.unique(['operation', 'idempotency_key']);
        table.engine('InnoDB');
    });

    await knex('system_counters').insert({ name: 'successful_orders', value: 0 });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('idempotency_keys');
    await knex.schema.alterTable('orders', (table) => table.dropForeign('coupon_id'));
    await knex.schema.dropTableIfExists('coupons');
    await knex.schema.dropTableIfExists('order_items');
    await knex.schema.dropTableIfExists('orders');
    await knex.schema.dropTableIfExists('system_counters');
    await knex.schema.dropTableIfExists('cart_items');
    await knex.schema.dropTableIfExists('carts');
    await knex.schema.dropTableIfExists('products');
}
