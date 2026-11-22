export class CliError extends Error {
    constructor(code, message, exitCode) {
        super(message);
        this.code = code;
        this.exitCode = exitCode;
    }
}

/**
 * 環境変数から既定の接続先オリジンを解決する。
 */
export function resolveDefaultUrl(env = process.env) {
    const explicitUrl = env?.TONARICE_CLI_URL?.trim();
    if (explicitUrl) return parseOrigin(explicitUrl).origin;
    const rawPort = (env?.TONARICE_PORT ?? env?.PORT ?? '').trim();
    if (!rawPort) return 'http://localhost:3000';
    if (!/^[0-9]+$/.test(rawPort)) {
        throw new CliError('invalid_input', 'ポート番号の環境変数は 1〜65535 の整数で指定してください。', 2);
    }
    const port = Number(rawPort);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        throw new CliError('invalid_input', 'ポート番号の環境変数が範囲外です。', 2);
    }
    return `http://localhost:${port}`;
}

export function parseArgs(args, env = process.env) {
    const command = args[0] === 'ping' ? 'ping' : args[0] === 'chat' && args[1] === 'send' ? 'chat' : args[0] === 'chat' && args[1] === 'interactive' ? 'interactive' : '';
    if (!command) throw new CliError('invalid_input', '使い方: node cli/index.js ping | chat send | chat interactive', 2);
    let url = '';
    let timeout = command === 'ping' ? 5000 : 90000;
    const chatConfig = { engine: 'lmstudio' };
    const seen = new Set();
    for (let index = command === 'ping' ? 1 : 2; index < args.length; index++) {
        const option = args[index];
        if (option === '--isolated' && !seen.has(option)) {
            seen.add(option);
            continue;
        }
        const allowed = command === 'interactive' ? ['--url', '--timeout', '--engine', '--model', '--lmstudio-endpoint', '--system-prompt'] : ['--url', '--timeout'];
        if (!allowed.includes(option) || seen.has(option) || !args[index + 1] || args[index + 1].startsWith('--')) {
            throw new CliError('invalid_input', 'オプションが不正です。', 2);
        }
        seen.add(option);
        const value = args[++index];
        if (option === '--url') url = value;
        else if (option === '--engine') {
            if (!['lmstudio', 'openai', 'gemini'].includes(value)) throw new CliError('invalid_input', '対応する engine を指定してください。', 2);
            chatConfig.engine = value;
        } else if (option === '--model') chatConfig.model = value;
        else if (option === '--lmstudio-endpoint') chatConfig.lmstudioEndpoint = value;
        else if (option === '--system-prompt') chatConfig.systemPrompt = value;
        else {
            if (!/^[0-9]+$/.test(value)) throw new CliError('invalid_input', 'タイムアウトは正の整数で指定してください。', 2);
            timeout = Number(value);
            if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647) throw new CliError('invalid_input', 'タイムアウトが範囲外です。', 2);
        }
    }
    const isolated = seen.has('--isolated');
    if (isolated) {
        if (!url) throw new CliError('invalid_input', '隔離テストには --url で接続先を指定してください。', 2);
        const origin = parseOrigin(url);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || !origin.port) {
            throw new CliError('invalid_input', '隔離テストにはローカルの接続先と明示ポートが必要です。', 2);
        }
    }
    if (!url) url = resolveDefaultUrl(env);
    return { command, url, timeout, ...(isolated ? { isolated } : {}), ...(command === 'interactive' ? { chatConfig, explicit: [...seen] } : {}) };
}

export function parseOrigin(baseUrl) {
    let url;
    try {
        url = new URL(baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    } catch {
        throw new CliError('invalid_input', '接続先は HTTP または HTTPS のオリジンを指定してください。', 2);
    }
    return url;
}

export async function ping(baseUrl, timeoutMs, fetcher = fetch) {
    const url = parseOrigin(baseUrl);
    let response;
    try {
        response = await fetcher(new URL('/api/ping', url), { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store' });
    } catch (error) {
        if (error?.name === 'TimeoutError') throw new CliError('timeout', 'サーバーへの接続がタイムアウトしました。', 5);
        throw new CliError('connection_error', 'サーバーとの接続エラーが発生しました。', 4);
    }
    if (!response.ok) throw new CliError('server_error', 'サーバーが正常な応答を返しませんでした。', 6);
    let data;
    try {
        data = await response.json();
    } catch (error) {
        if (error?.name === 'TimeoutError') throw new CliError('timeout', 'サーバーの応答がタイムアウトしました。', 5);
        throw new CliError('invalid_response', 'サーバーの応答を読み取れませんでした。', 6);
    }
    if (!data || data.success !== true || data.message !== 'pong') throw new CliError('invalid_response', 'サーバーの応答が ping の形式と一致しません。', 6);
    return { message: data.message, timestamp: data.timestamp, mastra: data.mastra, ...(typeof data.isolated === 'boolean' ? { isolated: data.isolated } : {}) };
}

export async function assertIsolatedServer(options, fetcher = fetch) {
    const status = await ping(options.url, options.timeout, fetcher);
    if (status.isolated !== true) throw new CliError('invalid_input', '接続先は隔離サーバーではありません。', 2);
    return status;
}

export async function run(args, fetcher = fetch, input, chatSend) {
    try {
        const options = parseArgs(args);
        const isolatedStatus = options.isolated ? await assertIsolatedServer(options, fetcher) : undefined;
        const result = options.command === 'ping'
            ? isolatedStatus || await ping(options.url, options.timeout, fetcher)
            : await chatSend(options, input);
        return { exitCode: 0, output: { version: 1, ok: true, result } };
    } catch (error) {
        const known = error instanceof CliError;
        return {
            exitCode: known ? error.exitCode : 6,
            output: { version: 1, ok: false, error: { code: known ? error.code : 'internal_error', message: known ? error.message : 'CLI の処理に失敗しました。' } }
        };
    }
}
