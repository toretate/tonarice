import { PassThrough, Readable, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
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

function mockClient() {
    return {
        list: async () => [{ id: 'm1', name: 'ミカ', profile: '明るい' }],
        activeId: async () => 'm1',
        config: async () => ({ selectedEngine: 'lmstudio' }),
        history: async () => ({ enabled: true, sessions: [] }),
        prompts: async () => ({ prompts: {} })
    };
}

async function waitFor(predicate) {
    for (let count = 0; count < 100; count++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('テストの待機がタイムアウトしました。');
}

function terminalStreams() {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => input;
    const output = capture();
    output.stream.isTTY = true;
    return { input, output };
}

describe('対話モード', () => {
    it('interactive_private会話を保存せず切替時に文脈を破棄する', async () => {
        const calls = [];
        let historyRequests = 0;
        const client = { ...mockClient(), history: async () => { historyRequests++; return { enabled: true, sessions: [{ id: 'normal', title: '通常', messages: [] }] }; } };
        const input = Readable.from(['/private\n秘密の話\n続き\n/private\n通常の話\n/exit\n']);
        const code = await interactive(parseArgs(['chat', 'interactive']), {
            input, output: capture().stream, errors: capture().stream, client,
            send: async (options, text) => { calls.push(JSON.parse(text)); return { text: '返事' }; }
        });
        assert.equal(code, 0);
        assert.equal(calls[0].memorySessionId, undefined);
        assert.deepEqual(calls[0].history, []);
        assert.deepEqual(calls[1].history, [{ sender: 'user', text: '秘密の話' }, { sender: 'mascot', text: '返事' }]);
        assert.equal(calls[2].memorySessionId, 'normal');
        assert.equal(calls[2].history, undefined);
        assert.equal(historyRequests, 1);
    });

    it('interactive_pで性格の編集案内を表示し複数行を保存する', async () => {
        const { input, output } = terminalStreams();
        const errors = capture();
        let saved;
        const client = { ...mockClient(), update: async request => { saved = request; return { id: request.id, name: 'ミカ', profile: request.profile }; } };
        const pending = interactive(parseArgs(['chat', 'interactive']), { input, output: output.stream, errors: errors.stream, client });
        input.write('/mascot\n');
        await waitFor(() => output.value().includes('番号または操作を入力'));
        input.write('p\n');
        await waitFor(() => output.value().includes('現在の性格・プロフィール'));
        assert.match(output.value(), /\/save で保存/);
        input.write('元気\n\n  丁寧\n/save\n');
        await waitFor(() => Boolean(saved));
        assert.equal(saved.profile, '元気\n\n  丁寧');
        assert.match(output.value(), /性格設定を保存しました/);
        input.write('/exit\n');
        assert.equal(await pending, 0);
        assert.equal(errors.value(), '');
    });

    it('interactive_Escでメニューを解除し矢印キーでは解除しない', async () => {
        const { input, output } = terminalStreams();
        const pending = interactive(parseArgs(['chat', 'interactive']), { input, output: output.stream, errors: capture().stream, client: mockClient() });
        input.write('/model\n');
        await waitFor(() => output.value().includes('番号を入力'));
        input.emit('keypress', undefined, { name: 'up', sequence: '\u001b[A' });
        assert.equal(output.value().includes('操作をキャンセルしました'), false);
        input.emit('keypress', undefined, { name: 'escape', sequence: '\u001b' });
        await waitFor(() => output.value().includes('操作をキャンセルしました'));
        input.write('/exit\n');
        assert.equal(await pending, 0);
    });

    it('interactive_Escで応答待ちを中断し次の発話へ進む', async () => {
        const { input, output } = terminalStreams();
        const errors = capture();
        let requests = 0;
        let started = false;
        const pending = interactive(parseArgs(['chat', 'interactive']), {
            input, output: output.stream, errors: errors.stream, client: mockClient(),
            send: async (options, text, dependencies) => {
                requests++;
                if (requests > 1) return { text: '次の応答' };
                started = true;
                return new Promise((resolve, reject) => dependencies.signal.addEventListener('abort', () => reject(new CliError('cancelled', '対話を中断しました。処理結果は不明です。', 130)), { once: true }));
            }
        });
        input.write('最初\n');
        await waitFor(() => started);
        input.emit('keypress', undefined, { name: 'escape', sequence: '\u001b' });
        await waitFor(() => errors.value().includes('処理結果は不明'));
        input.write('次\n');
        await waitFor(() => output.value().includes('次の応答'));
        input.write('/exit\n');
        assert.equal(await pending, 0);
        assert.equal(requests, 2);
    });

    it('interactive_Escでログイン待ちを中断し対話を継続する', async () => {
        const { input, output } = terminalStreams();
        const errors = capture();
        let started = false;
        const pending = interactive(parseArgs(['chat', 'interactive']), {
            input, output: output.stream, errors: errors.stream, client: mockClient(),
            login: async (options, stream, dependencies) => {
                started = true;
                return new Promise((resolve, reject) => dependencies.signal.addEventListener('abort', () => reject(new CliError('cancelled', 'ログインを中断しました。', 130)), { once: true }));
            }
        });
        input.write('/login\n');
        await waitFor(() => started);
        input.emit('keypress', undefined, { name: 'escape', sequence: '\u001b' });
        await waitFor(() => errors.value().includes('ログインを中断しました'));
        input.write('/exit\n');
        assert.equal(await pending, 0);
        assert.equal(output.value().includes('ログインしました。'), false);
    });
    it('interactive_実プロセスから連続する発話を送受信する', async () => {
        const http = createServer((request, response) => {
            response.setHeader('content-type', 'application/json');
            const url = new URL(request.url, 'http://localhost');
            const body = url.pathname === '/api/mascots' ? { success: true, mascots: [{ id: 'm1', name: 'ミカ', profile: '明るい' }] }
                : url.pathname === '/api/config' ? { success: true, config: { activeMascotId: 'm1', selectedEngine: 'lmstudio', lmstudioModel: 'gui-model' } }
                    : url.pathname === '/api/mastra-history' ? { enabled: true, sessions: [{ id: 'gui-session', title: '以前の会話', messages: [] }] }
                        : { success: true, prompts: {} };
            response.end(JSON.stringify(body));
        });
        const server = new WebSocketServer({ server: http });
        http.listen(0, '127.0.0.1');
        await once(http, 'listening');
        const requests = [];
        server.on('connection', socket => socket.on('message', raw => {
            requests.push(JSON.parse(raw.toString()).data);
            socket.send(JSON.stringify({ event: 'chat-response', data: { text: `応答${requests.length}` } }));
        }));
        try {
            const child = spawn(process.execPath, ['cli/index.js', '--url', `http://127.0.0.1:${http.address().port}`]);
            let output = '';
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', chunk => { output += chunk; });
            child.stdin.end('一回目\n二回目\n/exit\n');
            const [code] = await once(child, 'close');
            assert.equal(code, 0);
            assert.match(output, /マスコット: 応答2/);
            assert.equal(requests[1].memorySessionId, 'gui-session');
            assert.equal(requests[1].model, 'gui-model');
            assert.match(requests[1].systemPrompt, /明るい/);
            assert.equal(requests[0].toolUseEnabled, false);
        } finally { server.close(); http.close(); }
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
            input, output: output.stream, errors: errors.stream, client: mockClient(),
            send: async (options, text) => { calls.push(JSON.parse(text)); return { text: '応答' }; }
        });
        input.end('一回目\n二回目\n/clear\n三回目\n/exit\n');
        assert.equal(await pending, 0);
        assert.equal(calls[0].memorySessionId, calls[1].memorySessionId);
        assert.notEqual(calls[1].memorySessionId, calls[2].memorySessionId);
        assert.match(output.value(), /新しい会話を開始します/);
        assert.equal(errors.value(), '');
    });

    it('interactive_失敗した発話を履歴に含めず継続する', async () => {
        const output = capture();
        const errors = capture();
        const calls = [];
        const input = Readable.from(['失敗\n次\n/quit\n']);
        const code = await interactive(parseArgs(['chat', 'interactive']), {
            input, output: output.stream, errors: errors.stream, client: mockClient(),
            send: async (options, text) => {
                calls.push(JSON.parse(text));
                if (calls.length === 1) throw new CliError('timeout', 'タイムアウト', 5);
                return { text: '完了' };
            }
        });
        assert.equal(code, 0);
        assert.match(errors.value(), /タイムアウト/);
        assert.notEqual(calls[0].memoryUserMessageId, calls[1].memoryUserMessageId);
    });

    it('interactive_ログイン後の認証情報を対話に渡す', async () => {
        const output = capture();
        let session;
        const input = Readable.from(['/login\nこんにちは\n/exit\n']);
        await interactive(parseArgs(['chat', 'interactive']), {
            input, output: output.stream, errors: capture().stream, env: {}, client: mockClient(),
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
