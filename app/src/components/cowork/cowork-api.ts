import type { ScheduledPromptRun, ScheduledPromptTask } from '../../types/scheduled-prompt-task';
import { getHttpErrorMessage } from '../../utils/http-error-message';

export type CoWorkData = {
    scope: string;
    account: string;
    tasks: ScheduledPromptTask[];
    runs: ScheduledPromptRun[];
};

export class CoWorkApiError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
    }
}

export async function requestCoWork<T>(path: string, options: {
    method?: string;
    body?: unknown;
    scope?: string;
    signal?: AbortSignal;
    priority?: RequestPriority;
} = {}): Promise<T> {
    const { method = 'GET', body, scope, signal, priority } = options;
    const desktopRequest = window.electronAPI?.requestCoWork;
    if (desktopRequest) {
        const payload = body instanceof Blob ? await body.text() : body === undefined ? undefined : JSON.stringify(body);
        signal?.throwIfAborted();
        const { status, data } = await desktopRequest({ method, path, body: payload, scope });
        signal?.throwIfAborted();
        if (status >= 400) throw apiError(status, data);
        return data as T;
    }

    const headers = new Headers();
    if (method !== 'GET') headers.set('Content-Type', 'application/json');
    if (scope) headers.set('X-CoWork-Scope', scope);
    const timeout = AbortSignal.timeout(path === '/import' ? 60_000 : 15_000);
    const response = await fetch(`/api/cowork${path}`, {
        method,
        credentials: 'include',
        headers,
        body: body instanceof Blob ? body : body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        priority
    });
    if (!response.ok) {
        const detail = [400, 404, 409, 413].includes(response.status)
            ? await response.json().catch(() => null)
            : null;
        throw apiError(response.status, detail);
    }
    return response.status === 204 ? undefined as T : response.json();
}

function apiError(status: number, detail: unknown) {
    const fallback = status === 401
        ? 'CoWork を使うにはログインしてください。'
        : status >= 500 ? 'CoWork に接続できませんでした。' : getHttpErrorMessage(status);
    const message = [400, 404, 409, 413].includes(status) && detail && typeof detail === 'object'
        && 'message' in detail && typeof detail.message === 'string' ? detail.message : fallback;
    return new CoWorkApiError(status, message);
}
