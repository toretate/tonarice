import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { coworkImportMaxBytes, type CoWorkDesktopRequest } from '../../src/types/cowork-desktop';

const taskPath = /^\/tasks\/[\da-f-]{36}$/i;
const runPath = /^\/tasks\/[\da-f-]{36}\/run$/i;

export function isCoWorkRequestAllowed({ method, path }: CoWorkDesktopRequest) {
    if (typeof path !== 'string') return false;
    if (path === '/settings') return method === 'GET' || method === 'PUT' || method === 'DELETE';
    if (path === '/models') return method === 'POST';
    if (method === 'GET') return path === '' || path === '/activity';
    if (method === 'POST') return path === '/tasks' || path === '/import' || runPath.test(path);
    return (method === 'PATCH' || method === 'DELETE') && taskPath.test(path);
}

export function resolveCoWorkOrigin(local: URL, configured?: string) {
    const url = configured?.trim() ? new URL(configured) : new URL(local.origin);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('COWORK_SERVER_ORIGIN にはサーバーのオリジンを指定してください。');
    }
    if (url.protocol !== 'https:' &&
        (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
        throw new Error('CoWork の共有サーバーには HTTPS で接続してください。');
    }
    return url.origin;
}

export function registerCoWorkHandlers(localUrl: string) {
    const local = new URL(localUrl);
    let token: string | undefined;
    let pairing = false;

    const checkSender = (event: IpcMainInvokeEvent) => {
        const origin = event.senderFrame && new URL(event.senderFrame.url).origin;
        if (origin !== local.origin) throw new Error('CoWork の呼び出し元が不正です。');
    };
    const origin = () => resolveCoWorkOrigin(local, process.env.COWORK_SERVER_ORIGIN);

    ipcMain.handle('cowork:request', async (event, request: CoWorkDesktopRequest) => {
        checkSender(event);
        if (!request || !isCoWorkRequestAllowed(request) ||
            (request.body !== undefined && (typeof request.body !== 'string' || Buffer.byteLength(request.body) > coworkImportMaxBytes)) ||
            (request.scope !== undefined && !/^[a-f0-9]{64}$/.test(request.scope))) {
            throw new Error('CoWork の要求が不正です。');
        }
        const headers = new Headers();
        if (token) headers.set('Authorization', `Bearer ${token}`);
        if (request.method !== 'GET') headers.set('Content-Type', 'application/json');
        if (request.scope) headers.set('X-CoWork-Scope', request.scope);
        const response = await fetch(`${origin()}/api/cowork${request.path}`, {
            method: request.method,
            body: request.body,
            headers,
            redirect: 'error',
            signal: AbortSignal.timeout(request.path === '/import' ? 60_000 : 15_000)
        });
        const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
        return { status: response.status, data };
    });

    ipcMain.handle('cowork:open-pairing', async event => {
        checkSender(event);
        await shell.openExternal(`${origin()}/`);
    });

    ipcMain.handle('cowork:pair', async (event, code: string) => {
        checkSender(event);
        if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code) || pairing) return false;
        pairing = true;
        try {
            const response = await fetch(`${origin()}/api/cowork/pair/claim`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
                redirect: 'error',
                signal: AbortSignal.timeout(15_000)
            });
            if (!response.ok) return false;
            const data = await response.json() as { token?: string };
            if (!data.token || !/^cowork_[A-Za-z0-9_-]{43}$/.test(data.token)) return false;
            token = data.token;
            return true;
        } finally {
            pairing = false;
        }
    });
}
