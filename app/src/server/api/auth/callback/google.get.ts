import { defineEventHandler, toWebRequest } from 'h3';
import { getBetterAuth } from '../../../utils/better-auth-runtime';
import { completeCliLogin } from '../../../utils/cli-login';

export default defineEventHandler(async event => {
    const { auth } = await getBetterAuth();
    const response = await auth.handler(toWebRequest(event));
    const headers = new Headers(response.headers);
    const token = headers.get('set-auth-token');
    headers.delete('set-auth-token');
    const location = headers.get('location');
    if (!location || response.status !== 302) return new Response(response.body, { status: response.status, headers });

    const target = new URL(location, auth.options.baseURL as string);
    if (target.pathname !== '/api/auth/cli/finish') return new Response(null, { status: 302, headers });

    headers.set('cache-control', 'no-store');
    headers.set('referrer-policy', 'no-referrer');
    if (!token || !completeCliLogin(target.searchParams.get('state'), token)) {
        return new Response('ログイン要求が無効または期限切れです。', { status: 400, headers: {
            'cache-control': 'no-store', 'referrer-policy': 'no-referrer'
        } });
    }
    // CLI と Electron のセッションは確認に使ったブラウザーに保存しない。
    headers.delete('set-cookie');
    for (const cookie of response.headers.getSetCookie()) {
        if (!/^(?:__Secure-)?better-auth\.session_token=/.test(cookie)) headers.append('set-cookie', cookie);
    }
    headers.set('location', '/');
    return new Response(null, { status: 302, headers });
});
