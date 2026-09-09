import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './db.js';

const server = createApp().listen(config.port, (error) => {
    if (error) {
        console.error(`Unable to start checkout service: ${error.message}`);
        process.exitCode = 1;
        return;
    }
    console.log(`Checkout service listening on port ${config.port}`);
});

async function shutdown(signal) {
    console.log(`${signal} received; shutting down`);
    server.close(async () => {
        await db.destroy();
        process.exit(0);
    });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
