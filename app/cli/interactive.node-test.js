import { PassThrough, Readable, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { interactive } from './interactive.js';
import { parseArgs, CliError } from './main.js';
import { chatSend } from './chat.js';

function capture() {
    let text = '';
    return { stream: new Writable({ write(chunk, encoding, callback) { text += chunk.toString(); callback(); } }), value: () => text };
}

describe('対話モード', () => {
    it('interactive_実プロセスから連続する発話を送受信する', async () => {
        const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
        await once(server, 'listening');
        const requests = [];
        server.on('connection', socket => socket.on('message', raw => {
            requests.push(JSON.parse(raw.toString()).data);
            socket.send(JSON.stringify({ event: 'chat-response', data: { text: `応答${requests.length}` } }));
        }));
        try {
            const child = spawn(process.execPath, ['cli/index.js', '--url', `http://127.0.0.1:${server.address().port}`]);
            let output = '';
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', chunk => { output += chunk; });
            child.stdin.end('一回目\n二回目\n/exit\n');
            const [code] = await once(child, 'close');
            assert.equal(code, 0);
            assert.match(output, /マスコット: 応答2/);
            assert.deepEqual(requests[1].history, [{ sender: 'user', text: '一回目' }, { sender: 'mascot', text: '応答1' }]);
            assert.equal(requests[0].toolUseEnabled, false);
        } finally { server.close(); }
    });

    it('interactive_引数なしで対話モードを開始する', async () => {
        const child = spawn(process.execPath, ['cli/index.js']);
        let output = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => { output += chunk; });
        child.stdin.end('/exit\n');
        const [code] = await once(child, 'close');
        assert.equal(code, 0);
        assert.match(output, /対話を開始/);
    });
    it('parseArgs_対話モードの設定を解釈する', () => {
        const result = parseArgs(['chat', 'interactive', '--engine', 'openai', '--model', 'example', '--timeout', '1200']);
        assert.deepEqual(result.chatConfig, { engine: 'openai', model: 'example' });
        assert.equal(result.timeout, 1200);
        assert.throws(() => parseArgs(['chat', 'interactive', '--engine', 'unknown']), CliError);
    });

    it('interactive_会話を引き継ぎclearで消去して終了する', async () => {
        const output = capture();
        const errors = capture();
        const calls = [];
        const input = new PassThrough();
        const pending = interactive(parseArgs(['chat', 'interactive']), {
            input, output: output.stream, errors: errors.stream,
            send: async (options, text) => { calls.push(JSON.parse(text)); return { text: '応答' }; }
        });
        input.end('一回目\n二回目\n/clear\n三回目\n/exit\n');
        assert.equal(await pending, 0);
        assert.deepEqual(calls[1].history, [{ sender: 'user', text: '一回目' }, { sender: 'mascot', text: '応答' }]);
        assert.deepEqual(calls[2].history, []);
        assert.match(output.value(), /会話の文脈を消去しました/);
        assert.equal(errors.value(), '');
    });

    it('interactive_失敗した発話を履歴に含めず継続する', async () => {
        const output = capture();
        const errors = capture();
        const calls = [];
        const input = Readable.from(['失敗\n次\n/quit\n']);
        const code = await interactive(parseArgs(['chat', 'interactive']), {
            input, output: output.stream, errors: errors.stream,
            send: async (options, text) => {
                calls.push(JSON.parse(text));
                if (calls.length === 1) throw new CliError('timeout', 'タイムアウト', 5);
                return { text: '完了' };
            }
        });
        assert.equal(code, 0);
        assert.match(errors.value(), /タイムアウト/);
        assert.deepEqual(calls[1].history, []);
    });

    it('interactive_ログイン後の認証情報を対話に渡す', async () => {
        const output = capture();
        let session;
        const input = Readable.from(['/login\nこんにちは\n/exit\n']);
        await interactive(parseArgs(['chat', 'interactive']), {
            input, output: output.stream, errors: capture().stream, env: {},
            login: async () => 'private-token',
            send: async (options, text, dependencies) => { session = dependencies.env.TONARICE_SESSION_TOKEN; return { text: 'こんにちは' }; }
        });
        assert.equal(session, 'private-token');
        assert.equal(output.value().includes('private-token'), false);
    });

    it('chatSend_中断時に接続を閉じて結果不明を返す', async () => {
        const controller = new AbortController();
        const pending = chatSend({ url: 'http://127.0.0.1:3000', timeout: 1000 }, '{"message":"x","engine":"lmstudio"}', {
            signal: controller.signal,
            env: {},
            WebSocket: class {
                on(event, handler) { if (event === 'open') queueMicrotask(handler); }
                send() {}
                terminate() { controller.terminated = true; }
            }
        });
        await new Promise(resolve => setImmediate(resolve));
        controller.abort();
        await assert.rejects(pending, error => error.code === 'cancelled' && error.message.includes('不明'));
        assert.equal(controller.terminated, true);
    });
});
