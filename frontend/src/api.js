const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000/api';

export async function api(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.error?.message ?? `Request failed (${response.status})`);
        error.code = payload.error?.code ?? 'REQUEST_FAILED';
        error.details = payload.error?.details;
        throw error;
    }
    return payload;
}
