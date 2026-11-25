import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chatSend } from './chat.js';
import { CliError, parseArgs, resolveDefaultUrl, run } from './main.js';

describe('CLI 接続先解決', () => {
    it('run_隔離モードで通常サーバーまたはisolated欠落への発話を拒否しWebSocketを作らない', async () => {
        const args = ['chat', 'send', '--isolated'];
        assert.throws(() => parseArgs(args, { PORT: '3010' }), /--url/);
        for (const payload of [{ success: true, message: 'pong', isolated: false }, { success: true, message: 'pong' }]) {
            let pingCalls = 0;
            let wsCreated = false;
            const fetcher = async (url) => {
                pingCalls++;
                assert.equal(url.href, 'http://localhost:3010/api/ping');
                return Response.json(payload);
            };
            class GuardSocket {
                constructor() { wsCreated = true; }
            }
            const send = (opts, value, deps) => chatSend(opts, value, { ...deps, WebSocket: GuardSocket, env: {} });
            const result = await run([...args, '--url', 'http://localhost:3010'], fetcher, '{"message":"試験","engine":"lmstudio"}', send);
            assert.equal(result.exitCode, 2);
            assert.match(result.output.error.message, /隔離サーバーではありません/);
            assert.equal(pingCalls, 1);
            assert.equal(wsCreated, false);
        }
    });

    it('run_隔離モードの1送信につき差し替えたfetchのみでpingを1回だけ実行して発話する', async () => {
        let pingCalls = 0;
        const fetcher = async (url) => {
            pingCalls++;
            assert.equal(url.href, 'http://127.0.0.1:3010/api/ping');
            return Response.json({ success: true, message: 'pong', isolated: true });
        };
        class FakeSocket extends EventEmitter {
            constructor() {
                super();
                queueMicrotask(() => this.emit('open'));
            }
            send() {
                queueMicrotask(() => this.emit('message', JSON.stringify({ event: 'chat-response', data: { text: 'OK', emotion: 'neutral' } })));
            }
            terminate() {}
        }
        const send = (opts, value, deps) => chatSend(opts, value, { ...deps, WebSocket: FakeSocket, env: {} });
        const result = await run(['chat', 'send', '--isolated', '--url', 'http://127.0.0.1:3010'], fetcher, '{"message":"試験","engine":"lmstudio"}', send);
        assert.equal(result.exitCode, 0);
        assert.equal(result.output.result.text, 'OK');
        assert.equal(pingCalls, 1);
    });

    it('run_隔離状態を確認できた場合はpingの結果を返す', async () => {
        const result = await run(['ping', '--isolated', '--url', 'http://127.0.0.1:3010'], async url => {
            assert.equal(url.href, 'http://127.0.0.1:3010/api/ping');
            return Response.json({ success: true, message: 'pong', isolated: true });
        });
        assert.equal(result.exitCode, 0);
        assert.equal(result.output.result.isolated, true);
    });

    it('resolveDefaultUrl_環境変数の優先順位に従って既定URLを決定する', () => {
        assert.equal(resolveDefaultUrl({}), 'http://localhost:3000');
        assert.equal(resolveDefaultUrl({ PORT: '3005' }), 'http://localhost:3005');
        assert.equal(resolveDefaultUrl({ PORT: '3005', TONARICE_PORT: '3010' }), 'http://localhost:3010');
        assert.equal(
            resolveDefaultUrl({ PORT: '3005', TONARICE_PORT: '3010', TONARICE_CLI_URL: 'http://127.0.0.1:3020' }),
            'http://127.0.0.1:3020'
        );
    });

    it('resolveDefaultUrl_不正なポートまたはURL環境変数を拒否する', () => {
        assert.throws(() => resolveDefaultUrl({ TONARICE_PORT: 'invalid' }), (err) => err instanceof CliError && err.code === 'invalid_input' && err.exitCode === 2);
        assert.throws(() => resolveDefaultUrl({ TONARICE_PORT: '70000' }), (err) => err instanceof CliError && err.code === 'invalid_input' && err.exitCode === 2);
        assert.throws(() => resolveDefaultUrl({ TONARICE_CLI_URL: 'http://localhost:3010/path' }), (err) => err instanceof CliError && err.code === 'invalid_input' && err.exitCode === 2);
    });

    it('parseArgs_urlオプション未指定時は環境変数を使い明示指定時は引数を優先する', () => {
        const fromEnv = parseArgs(['ping'], { TONARICE_PORT: '3010' });
        assert.equal(fromEnv.url, 'http://localhost:3010');

        const fromArg = parseArgs(['ping', '--url', 'http://127.0.0.1:3099'], { TONARICE_PORT: 'invalid' });
        assert.equal(fromArg.url, 'http://127.0.0.1:3099');
    });
});
