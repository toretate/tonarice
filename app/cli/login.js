import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { CliError, parseOrigin } from './main.js';

function openBrowser(url) {
    const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
}

export async function login(options, output, dependencies = {}) {
    const origin = parseOrigin(options.url);
    if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new CliError('invalid_input', 'ログイン先は HTTPS またはローカルにしてください。', 2);
    const fetcher = dependencies.fetch || fetch;
    const signal = dependencies.signal;
    const request = async (path, body) => {
        let response;
        try {
            response = await fetcher(new URL(path, origin), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(options.timeout)]) : AbortSignal.timeout(options.timeout) });
        } catch {
            if (signal?.aborted) throw new CliError('cancelled', 'ログインを中断しました。', 130);
            throw new CliError('connection_error', 'ログインサーバーとの接続に失敗しました。', 4);
        }
        if (!response.ok) throw new CliError('auth_error', 'ログイン要求が拒否されたか期限切れです。', 3);
        try { return await response.json(); } catch { throw new CliError('invalid_response', 'ログイン応答の形式が不正です。', 6); }
    };
    const start = await request('/api/auth/cli/start', {});
    if (!/^[A-Za-z0-9_-]{43}$/.test(start?.state) || !/^[A-Za-z0-9_-]{43}$/.test(start?.verifier) || !Number.isInteger(start.expiresIn) || start.expiresIn < 1 || start.expiresIn > 300) throw new CliError('invalid_response', 'ログイン応答の形式が不正です。', 6);
    const loginUrl = new URL('/api/auth/login', origin);
    loginUrl.searchParams.set('cli_state', start.state);
    output.write(`ブラウザーでログインしてください: ${loginUrl}\n`);
    try { (dependencies.openBrowser || openBrowser)(loginUrl.toString()); } catch { /* URLを手動で開ける。 */ }
    const deadline = Date.now() + start.expiresIn * 1000;
    while (Date.now() < deadline) {
        const result = await request('/api/auth/cli/claim', { state: start.state, verifier: start.verifier });
        if (result?.status === 'complete' && typeof result.token === 'string' && result.token) return result.token;
        if (result?.status !== 'pending') throw new CliError('invalid_response', 'ログイン応答の形式が不正です。', 6);
        try { await (dependencies.delay || delay)(1500, undefined, { signal }); }
        catch { throw new CliError('cancelled', 'ログインを中断しました。', 130); }
    }
    throw new CliError('timeout', 'ログインがタイムアウトしました。', 5);
}
