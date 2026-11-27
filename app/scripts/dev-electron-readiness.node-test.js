import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { it } from 'node:test';
import { isDevServerListening, waitForDevServer } from './dev-electron-readiness.js';

async function startServer(t, handler) {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1');
    t.after(() => new Promise(resolve => {
        server.closeAllConnections();
        server.close(resolve);
    }));
    await once(server, 'listening');
    return new URL(`http://127.0.0.1:${server.address().port}/`);
}

it('waitForDevServer_Nitroが応答するまでページを開かず起動中の503を再試行する', async t => {
    const paths = [];
    let healthRequests = 0;
    let pageRequests = 0;
    const url = await startServer(t, (request, response) => {
        paths.push(request.url);
        if (request.url === '/api/ping') {
            healthRequests += 1;
            if (healthRequests === 1) {
                response.writeHead(503).end();
            } else {
                response.writeHead(200, { 'Content-Type': 'application/json' })
                    .end(JSON.stringify({ success: true, message: 'pong' }));
            }
            return;
        }
        pageRequests += 1;
        response.writeHead(pageRequests === 1 ? 503 : 200).end();
    });

    assert.equal(await isDevServerListening(url), true);
    assert.deepEqual(paths, []);
    await waitForDevServer(url, { timeoutMs: 3000, retryMs: 10 });
    assert.deepEqual(paths, ['/api/ping', '/api/ping', '/', '/api/ping', '/']);
});

it('waitForDevServer_HTTPの応答が止まっても起動確認を打ち切る', async t => {
    const url = await startServer(t, () => {});

    await assert.rejects(waitForDevServer(url, { timeoutMs: 120, retryMs: 10 }), /タイムアウト/);
});
