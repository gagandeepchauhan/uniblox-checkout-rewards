import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { AppError } from './errors.js';
import { apiRouter } from './routes.js';

export function createApp() {
    const app = express();
    app.disable('x-powered-by');
    app.use(helmet());
    app.use(cors({ origin: config.frontendOrigin }));
    app.use(express.json({ limit: '32kb' }));
    app.get('/health', (_request, response) => response.json({ status: 'ok' }));
    app.use('/api', apiRouter);
    app.use((_request, response) => response.status(404).json({
        error: { code: 'ROUTE_NOT_FOUND', message: 'Route was not found.', details: {} }
    }));
    app.use((error, _request, response, _next) => {
        if (error instanceof AppError) {
            return response.status(error.status).json({
                error: { code: error.code, message: error.message, details: error.details }
            });
        }
        if (error instanceof SyntaxError && error.status === 400) {
            return response.status(400).json({
                error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON.', details: {} }
            });
        }
        if (config.env !== 'test') console.error(error);
        return response.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', details: {} }
        });
    });
    return app;
}
