import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { chatSend, parseChatInput } from './chat.js';
import { run } from './main.js';

const options = { url: 'http://127.0.0.1:3000', timeout: 1000 };
const input = JSON.stringify({ message: 'こんにちは', engine: 'lmstudio' });

class FakeSocket extends EventEmitter {
    static latest;
    constructor(url, config) {
        super();
        FakeSocket.latest = this;
        this.url = url;
        this.config = config;
        this.sent = [];
        queueMicrotask(() => this.emit('open'));
    }
    send(value) { this.sent.push(JSON.parse(value)); }
    terminate() { this.terminated = true; }
}

describe('chat send', () => {
    it('chatSend_実際のプロセスとWebSocketで対話を完了する', async () => {
        const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
        await once(server, 'listening');
        server.on('connection', socket => {
            socket.on('message', raw => {
                const message = JSON.parse(raw.toString());
                assert.equal(message.event, 'chat-send');
                assert.equal(message.data.toolUseEnabled, false);
                socket.send(JSON.stringify({ event: 'chat-response', data: { text: '応答', emotion: 'neutral' } }));
            });
        });
        try {
            const child = spawn(process.execPath, ['cli/index.js', '-p', '--url', `http://127.0.0.1:${server.address().port}`]);
            let output = '';
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', chunk => { output += chunk; });
            child.stdin.end(input);
            const [code] = await once(child, 'close');
            assert.equal(code, 0);
            assert.equal(JSON.parse(output).result.text, '応答');
        } finally {
            server.close();
        }
    });
    it('parseChatInput_既定で履歴を保存せずツールを無効にする', () => {
        const payload = parseChatInput(input, {});
        assert.equal(payload.toolUseEnabled, false);
        assert.equal(payload.useTts, false);
        assert.equal(payload.memorySessionId, undefined);
        assert.ok(payload.turnId);
    });

    it('parseChatInput_エンジン別の環境変数を使い専用設定を優先する', () => {
        const env = { OPENAI_API_KEY: 'openai-test', GEMINI_API_KEY: 'gemini-test', TONARICE_AI_API_KEY: 'override-test' };
        const request = engine => JSON.stringify({ message: 'x', engine });
        assert.equal(parseChatInput(request('openai'), env).apiKey, 'override-test');
        delete env.TONARICE_AI_API_KEY;
        assert.equal(parseChatInput(request('openai'), env).apiKey, 'openai-test');
        assert.equal(parseChatInput(request('gemini'), env).apiKey, 'gemini-test');
        assert.equal(parseChatInput(request('lmstudio'), env).apiKey, '');
    });

    it('parseChatInput_不正な履歴識別子と余分な項目を拒否する', () => {
        assert.throws(() => parseChatInput(JSON.stringify({ message: 'x', engine: 'openai', memorySessionId: 'x' }), {}));
        assert.throws(() => parseChatInput(JSON.stringify({ message: 'x', engine: 'openai', apiKey: 'secret' }), {}));
    });

    it('chatSend_認証情報を Cookie で送信し承認を拒否して応答を返す', async () => {
        const pending = chatSend(options, input, { WebSocket: FakeSocket, env: { TONARICE_SESSION_TOKEN: 'token' } });
        await new Promise(resolve => setImmediate(resolve));
        const socket = FakeSocket.latest;
        assert.equal(socket.config.headers.Cookie, 'session_token=token');
        assert.equal(socket.sent[0].event, 'chat-send');
        socket.emit('message', JSON.stringify({ event: 'tool-approval-request', data: { id: 'approval', name: 'test' } }));
        assert.deepEqual(socket.sent[1], { event: 'tool-approval-response', data: { id: 'approval', approved: false } });
        socket.emit('message', JSON.stringify({ event: 'chat-response', data: { text: 'こんにちは', emotion: 'happy' } }));
        const result = await pending;
        assert.equal(result.text, 'こんにちは');
        assert.equal(socket.terminated, true);
    });

    it('chatSend_認証失敗と送信後のタイムアウトを区別する', async () => {
        const closed = chatSend(options, input, { WebSocket: FakeSocket, env: {} });
        await new Promise(resolve => setImmediate(resolve));
        FakeSocket.latest.emit('close', 4001);
        await assert.rejects(closed, error => error.code === 'auth_error');
        await assert.rejects(chatSend({ ...options, timeout: 5 }, input, { WebSocket: FakeSocket, env: {} }), error => error.code === 'timeout' && error.message.includes('不明'));
    });

    it('chatSend_指定した入力に一致する操作を一度だけ承認する', async () => {
        const request = JSON.stringify({ message: 'x', engine: 'lmstudio', enableTools: true, approval: { name: 'manageTasks', input: { action: 'delete', id: '1' } } });
        const pending = chatSend(options, request, { WebSocket: FakeSocket, env: {} });
        await new Promise(resolve => setImmediate(resolve));
        const socket = FakeSocket.latest;
        const data = { id: 'a', name: 'manageTasks', input: { id: '1', action: 'delete' } };
        socket.emit('message', JSON.stringify({ event: 'tool-approval-request', data }));
        socket.emit('message', JSON.stringify({ event: 'tool-approval-request', data: { ...data, id: 'b' } }));
        assert.equal(socket.sent[1].data.approved, true);
        assert.equal(socket.sent[2].data.approved, false);
        socket.emit('message', JSON.stringify({ event: 'chat-response', data: { text: '完了' } }));
        assert.deepEqual((await pending).approvals.map(item => item.approved), [true, false]);
    });

    it('run_平文の遠隔接続へ認証情報を送らない', async () => {
        const send = (opts, value) => chatSend(opts, value, { WebSocket: FakeSocket, env: { TONARICE_AI_API_KEY: 'secret' } });
        const result = await run(['chat', 'send', '--url', 'http://example.com'], fetch, input, send);
        assert.equal(result.output.error.code, 'invalid_input');
        assert.equal(JSON.stringify(result).includes('secret'), false);
    });
});
