import { defineEventHandler, getHeader, createError, toWebRequest } from 'h3';
import { readUsersConfig } from '../utils/auth-users';
import { requireBetterAuthSession } from '../utils/better-auth-runtime';
import { isAuthBypassAllowed } from '../utils/auth-bypass';
import { findCoWorkDesktopOwner } from '../cowork/pairing';

export { readUsersConfig, writeUsersConfig } from '../utils/auth-users';
export type { Identity, User } from '../utils/auth-users';

export default defineEventHandler(async (event) => {
    // リクエストURIを取得して、APIリクエストでなければスキップ（例: /_nuxt/ など静的ファイルやWEBフロントエンドページへのアクセス）
    const url = (event.path || '').split('?')[0];
    if (!url.startsWith('/api/')) {
        return;
    }

    // 認証開始・OAuthコールバック・pingは未認証でアクセスできる必要がある。
    if (url === '/api/ping' || url === '/api/auth/login' || url === '/api/auth/callback' || url === '/api/auth/callback/google' || url === '/api/auth/logout'
        || url === '/api/cowork/pair/claim'
        || url === '/api/auth/cli/start' || url === '/api/auth/cli/claim') {
        return;
    }

    // 開発・家庭内テスト用の認証バイパスは、明示的な環境変数がある場合だけ許可する。
    if (isAuthBypassAllowed()) {
        event.context.user = {
            id: 'usr_local_dev_bypass',
            email: 'test-user@gmail.com',
            role: 'user'
        };
        return;
    }

    const authHeader = getHeader(event, 'authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';

    // デスクトップ接続用の短期セッションは CoWork のデータ操作に限定する。
    if (token.startsWith('cowork_')) {
        const allowed = url === '/api/cowork' || url === '/api/cowork/activity' || url === '/api/cowork/import' ||
            url === '/api/cowork/settings' || url === '/api/cowork/models' ||
            url === '/api/cowork/tasks' || url.startsWith('/api/cowork/tasks/');
        if (!allowed || !authHeader?.startsWith('Bearer ')) throw createError({ statusCode: 403 });
        const owner = findCoWorkDesktopOwner(token);
        const user = owner && readUsersConfig().users.find(candidate => candidate.id === owner);
        if (!user) throw createError({ statusCode: 401, message: 'CoWork のデスクトップ接続を更新してください。' });
        event.context.user = { id: user.id, email: user.identities.find(identity => identity.email)?.email || '', role: user.role };
        return;
    }

    const headers = toWebRequest(event).headers;
    const method = event.method || 'GET';
    if (headers.has('cookie') && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        const expectedOrigin = process.env.BETTER_AUTH_URL && new URL(process.env.BETTER_AUTH_URL).origin;
        if (!expectedOrigin || headers.get('origin') !== expectedOrigin) throw createError({ statusCode: 403 });
    }
    const { user } = await requireBetterAuthSession(headers);
    event.context.user = {
        id: user.id,
        email: user.identities.find(identity => identity.email)?.email || '',
        role: user.role
    };
});
