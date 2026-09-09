export class AppError extends Error {
    constructor(status, code, message, details = {}) {
        super(message);
        this.name = 'AppError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export function notFound(resource, id) {
    return new AppError(404, `${resource.toUpperCase()}_NOT_FOUND`, `${resource} was not found.`, { id });
}
