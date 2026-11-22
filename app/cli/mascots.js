import { CliError, parseOrigin } from './main.js';

export function createMascotClient(options, dependencies = {}) {
    const origin = parseOrigin(options.url);
    const fetcher = dependencies.fetch || fetch;
    async function request(path, body) {
        const token = (dependencies.env || process.env).TONARICE_SESSION_TOKEN || '';
        if ((token || path === '/api/config') && origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new CliError('invalid_input', '設定や認証情報を使用する接続先は HTTPS またはローカルにしてください。', 2);
        let response;
        try {
            response = await fetcher(new URL(path, origin), {
                method: body ? 'POST' : 'GET',
                headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
                redirect: 'error', signal: AbortSignal.timeout(options.timeout)
            });
        } catch {
            const message = body
                ? `サーバー ${origin.origin} に接続できません。変更結果が不明なため再取得してください。`
                : `サーバー ${origin.origin} に接続できません。app で npm run dev:cli を実行し、接続先とポートを確認してください。`;
            throw new CliError('connection_error', message, 4);
        }
        if (!response.ok) {
            const authError = response.status === 401 || response.status === 403;
            throw new CliError(authError ? 'auth_error' : 'server_error', authError ? '認証が必要です。/login を使用するか、サーバーの認証設定を確認してください。' : 'マスコット設定を取得または保存できませんでした。', authError ? 3 : 6);
        }
        const result = await response.json();
        if (!result || typeof result !== 'object' || result.success === false) throw new CliError('server_error', 'マスコット設定の応答が不正です。', 6);
        return result;
    }
    return {
        async list() { const result = await request('/api/mascots'); if (result.success !== true || !Array.isArray(result.mascots)) throw new CliError('server_error', 'マスコット一覧が不正です。', 6); return result.mascots; },
        async activeId() { const result = await request('/api/config'); return result.config?.activeMascotId || ''; },
        async config() { const result = await request('/api/config'); if (result.success !== true || !result.config || typeof result.config !== 'object') throw new CliError('server_error', '設定の応答が不正です。', 6); return result.config; },
        async history(id) { return request(`/api/mastra-history?${new URLSearchParams({ mascotId: id })}`); },
        async prompts(id) { return request(`/api/mascots/cli-prompts?${new URLSearchParams({ mascotId: id })}`); },
        async listData(kind) { return request(kind === 'memo' ? '/api/memos' : '/api/tasks'); },
        async updateData(body) { return request('/api/cli-data', body); },
        async update(body) { const result = await request('/api/mascots/cli', body); if (!result.mascot?.id) throw new CliError('server_error', '保存結果が不正です。', 6); return result.mascot; }
    };
}
