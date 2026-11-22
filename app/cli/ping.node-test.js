import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './main.js';

describe('CLI', () => {
    it('run_pingの応答を構造化して返す', async () => {
        const server = createServer((request, response) => {
            assert.equal(request.url, '/api/ping');
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ success: true, message: 'pong', timestamp: 'test', mastra: { initialized: false } }));
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        try {
            const actual = await run(['ping', '--url', `http://127.0.0.1:${server.address().port}`]);
            assert.equal(actual.exitCode, 0);
            assert.deepEqual(actual.output.result.mastra, { initialized: false });
        } finally {
            server.close();
        }
    });

    it('run_不正な引数を拒否する', async () => {
        for (const args of [[], ['ping', '--timeout', '0'], ['ping', '--url', 'http://user:secret@localhost'], ['ping', '--url', 'http://localhost/path'], ['ping', '--unknown']]) {
            const result = await run(args);
            assert.equal(result.exitCode, 2);
            assert.equal(result.output.error.code, 'invalid_input');
        }
    });

    it('run_接続失敗とタイムアウトを区別する', async () => {
        const unavailable = await run(['ping'], async () => { throw new TypeError('secret'); });
        assert.equal(unavailable.output.error.code, 'connection_error');
        const timedOut = await run(['ping'], async () => { throw new DOMException('secret', 'TimeoutError'); });
        assert.equal(timedOut.output.error.code, 'timeout');
    });

    it('run_不正な正常応答を失敗にする', async () => {
        const result = await run(['ping'], async () => new Response('{}', { status: 200 }));
        assert.equal(result.output.error.code, 'invalid_response');
        assert.equal(result.exitCode, 6);
    });
});
