import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// HTTP リクエストを送らず、既存のサーバーが待ち受けているか確認する。
export function isDevServerListening(url) {
    return new Promise(resolve => {
        const socket = net.createConnection({ host: url.hostname, port: Number(url.port || 80) });
        const finish = listening => {
            socket.destroy();
            resolve(listening);
        };
        socket.setTimeout(1500, () => finish(false));
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
    });
}

export async function waitForDevServer(url, { timeoutMs = 60_000, retryMs = 1_000, childSignal } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = 'HTTP 応答なし';

    while (Date.now() < deadline) {
        childSignal?.throwIfAborted();
        const attempt = AbortSignal.timeout(Math.max(1, Math.min(5_000, deadline - Date.now())));
        const signal = childSignal ? AbortSignal.any([attempt, childSignal]) : attempt;
        try {
            const health = await fetch(new URL('/api/ping', url), {
                signal,
                redirect: 'error',
                headers: { Accept: 'application/json' }
            });
            lastStatus = `/api/ping HTTP ${health.status}`;
            if (health.ok) {
                const { success, message } = await health.json();
                if (success === true && message === 'pong') {
                    const page = await fetch(url, { signal });
                    lastStatus = `/ HTTP ${page.status}`;
                    await page.body?.cancel();
                    if (page.status === 200) return;
                }
            } else {
                await health.body?.cancel();
            }
        } catch {
            childSignal?.throwIfAborted();
        }

        await delay(Math.min(retryMs, Math.max(0, deadline - Date.now())));
    }

    childSignal?.throwIfAborted();
    throw new Error(`Nuxt 開発サーバーの起動確認がタイムアウトしました (${lastStatus})。`);
}
