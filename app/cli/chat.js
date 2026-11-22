import { randomUUID } from 'node:crypto';
import { CliError, parseOrigin } from './main.js';

const allowedFields = new Set(['message', 'engine', 'model', 'systemPrompt', 'lmstudioEndpoint', 'history', 'activeMascotId', 'memorySessionId', 'memoryUserMessageId', 'memoryAssistantMessageId', 'turnId', 'temperature', 'frequencyPenalty', 'repetitionPenalty', 'maxOutputTokens', 'enableThinking', 'enableTools', 'tools', 'approval']);

export function resolveApiKey(engine, env, fallback = '') {
    const providerKey = engine === 'openai' ? env.OPENAI_API_KEY : engine === 'gemini' ? env.GEMINI_API_KEY : '';
    return env.TONARICE_AI_API_KEY || providerKey || fallback || '';
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}

export function parseChatInput(text, env = process.env) {
    let input;
    try {
        if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error();
        input = JSON.parse(text);
    } catch {
        throw new CliError('invalid_input', '標準入力に 1 MB 以下の JSON オブジェクトを指定してください。', 2);
    }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowedFields.has(key))
        || typeof input.message !== 'string' || !input.message.trim()
        || !['lmstudio', 'gemini', 'openai'].includes(input.engine)) {
        throw new CliError('invalid_input', 'message と対応する engine を指定してください。未対応の項目は指定できません。', 2);
    }
    if (input.enableTools !== undefined && typeof input.enableTools !== 'boolean') throw new CliError('invalid_input', 'enableTools は真偽値で指定してください。', 2);
    if (input.approval !== undefined && (input.enableTools !== true || !input.approval || typeof input.approval !== 'object' || Array.isArray(input.approval)
        || Object.keys(input.approval).sort().join(',') !== 'input,name' || typeof input.approval.name !== 'string' || !input.approval.name
        || !input.approval.input || typeof input.approval.input !== 'object' || Array.isArray(input.approval.input))) {
        throw new CliError('invalid_input', '承認には enableTools と対象ツール名・入力を指定してください。', 2);
    }
    const memoryKeys = ['memorySessionId', 'activeMascotId', 'memoryUserMessageId', 'memoryAssistantMessageId'];
    if (input.memorySessionId !== undefined && (memoryKeys.some(key => input[key] === undefined)
        || typeof input.memorySessionId !== 'string' || !input.memorySessionId || input.memorySessionId.length > 200
        || typeof input.activeMascotId !== 'string' || !input.activeMascotId || input.activeMascotId.length > 200
        || !Number.isSafeInteger(input.memoryUserMessageId) || input.memoryUserMessageId <= 1
        || !Number.isSafeInteger(input.memoryAssistantMessageId) || input.memoryAssistantMessageId <= input.memoryUserMessageId
        || input.memoryAssistantMessageId > 8640000000000000)) {
        throw new CliError('invalid_input', '履歴保存にはマスコット、会話、昇順のメッセージ ID が必要です。', 2);
    }
    if (input.memorySessionId === undefined && (input.memoryUserMessageId !== undefined || input.memoryAssistantMessageId !== undefined)) {
        throw new CliError('invalid_input', 'メッセージ ID には会話 ID が必要です。', 2);
    }
    const { enableTools, approval, ...data } = input;
    return { ...data, apiKey: resolveApiKey(input.engine, env), turnId: input.turnId || randomUUID(), toolUseEnabled: enableTools === true, tools: enableTools === true ? input.tools : {}, useTts: false };
}

export async function chatSend(options, text, dependencies = {}) {
    if (dependencies.signal?.aborted) throw new CliError('cancelled', '対話を中断しました。', 130);
    const input = parseChatInput(text, dependencies.env);
    const approval = JSON.parse(text).approval;
    let approvedOnce = false;
    const approvals = [];
    const origin = parseOrigin(options.url);
    const token = (dependencies.env || process.env).TONARICE_SESSION_TOKEN || '';
    if ((token || input.apiKey) && origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
        throw new CliError('invalid_input', '認証情報を使用する接続先は HTTPS またはローカルにしてください。', 2);
    }
    let WebSocket = dependencies.WebSocket;
    if (!WebSocket) {
        try { WebSocket = (await import('ws')).default; }
        catch { throw new CliError('dependency_error', 'ws が見つかりません。app で依存関係をインストールしてください。', 6); }
    }
    const url = new URL('/ws', origin);
    url.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
    return new Promise((resolve, reject) => {
        let socket;
        let sent = false;
        let settled = false;
        const onAbort = () => finish(new CliError('cancelled', sent ? '対話を中断しました。処理結果は不明です。' : '対話を中断しました。', 130));
        const timer = setTimeout(() => finish(new CliError('timeout', sent ? '応答がタイムアウトしました。処理結果は不明です。' : '接続がタイムアウトしました。', 5)), options.timeout);
        function finish(error, result) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            dependencies.signal?.removeEventListener('abort', onAbort);
            if (socket) socket.terminate();
            if (error) reject(error); else resolve(result);
        }
        dependencies.signal?.addEventListener('abort', onAbort, { once: true });
        if (dependencies.signal?.aborted) { onAbort(); return; }
        try {
            socket = new WebSocket(url, { headers: token ? { Cookie: `session_token=${encodeURIComponent(token)}` } : {} });
            socket.on('open', () => {
                try { socket.send(JSON.stringify({ event: 'chat-send', data: input })); sent = true; }
                catch { finish(new CliError('connection_error', '送信に失敗しました。処理結果は不明です。', 4)); }
            });
            socket.on('message', raw => {
                let message;
                try { message = JSON.parse(raw.toString()); }
                catch { finish(new CliError('invalid_response', 'サーバーの応答を読み取れませんでした。', 6)); return; }
                if (!message || typeof message !== 'object' || Array.isArray(message)) { finish(new CliError('invalid_response', 'サーバーの応答形式が不正です。', 6)); return; }
                if (message.event === 'tool-approval-request') {
                    if (typeof message.data?.id !== 'string') { finish(new CliError('invalid_response', '承認要求が不正です。', 6)); return; }
                    const approved = !approvedOnce && approval && approval.name === message.data.name
                        && JSON.stringify(canonical(approval.input)) === JSON.stringify(canonical(message.data.input));
                    if (approved) approvedOnce = true;
                    approvals.push({ name: typeof message.data.name === 'string' ? message.data.name : '', approved: approved === true });
                    try { socket.send(JSON.stringify({ event: 'tool-approval-response', data: { id: message.data.id, approved: approved === true } })); }
                    catch { finish(new CliError('connection_error', '承認拒否の送信に失敗しました。処理結果は不明です。', 4)); }
                } else if (message.event === 'chat-response') {
                    if (typeof message.data?.text !== 'string') { finish(new CliError('invalid_response', '対話応答が不正です。', 6)); return; }
                    finish(null, { text: message.data.text, emotion: message.data.emotion, turnId: input.turnId, approvals });
                } else if (message.event === 'chat-error') {
                    finish(new CliError('chat_error', '対話処理に失敗しました。サーバーの設定とログを確認してください。', 6));
                }
            });
            socket.on('error', () => finish(new CliError('connection_error', sent ? '接続が失われました。処理結果は不明です。' : 'サーバーとの接続エラーが発生しました。', 4)));
            socket.on('close', code => finish(new CliError(code === 4001 || code === 4003 ? 'auth_error' : 'connection_error', code === 4001 || code === 4003 ? '認証に失敗しました。' : sent ? '接続が切断されました。処理結果は不明です。' : 'サーバーに接続できませんでした。', code === 4001 || code === 4003 ? 3 : 4)));
        } catch {
            finish(new CliError('connection_error', 'サーバーとの接続エラーが発生しました。', 4));
        }
    });
}
