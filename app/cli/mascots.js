import { CliError, parseOrigin } from './main.js';

export function createMascotClient(options, dependencies = {}) {
    const origin = parseOrigin(options.url);
    const fetcher = dependencies.fetch || fetch;
    async function request(path, body) {
        const token = (dependencies.env || process.env).TONARICE_SESSION_TOKEN || '';
        if (token && origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new CliError('invalid_input', '認証情報を使用する接続先は HTTPS またはローカルにしてください。', 2);
        let response;
        try {
            response = await fetcher(new URL(path, origin), {
                method: body ? 'POST' : 'GET',
                headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
                redirect: 'error', signal: AbortSignal.timeout(options.timeout)
            });
        } catch { throw new CliError('connection_error', 'マスコット設定サーバーとの接続エラー。変更結果が不明な場合は再取得してください。', 4); }
        if (!response.ok) throw new CliError(response.status === 401 || response.status === 403 ? 'auth_error' : 'server_error', 'マスコット設定を取得または保存できませんでした。', response.status === 401 || response.status === 403 ? 3 : 6);
        const result = await response.json();
        if (result?.success !== true) throw new CliError('server_error', 'マスコット設定の応答が不正です。', 6);
        return result;
    }
    return {
        async list() { const result = await request('/api/mascots'); if (!Array.isArray(result.mascots)) throw new CliError('server_error', 'マスコット一覧が不正です。', 6); return result.mascots; },
        async activeId() { const result = await request('/api/config'); return result.config?.activeMascotId || ''; },
        async update(body) { const result = await request('/api/mascots/cli', body); if (!result.mascot?.id) throw new CliError('server_error', '保存結果が不正です。', 6); return result.mascot; }
    };
}
