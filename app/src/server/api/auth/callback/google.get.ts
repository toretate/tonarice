import { defineEventHandler, toWebRequest } from 'h3';
import { electronAuthCompletion } from '../../../../utils/electron-auth-protocol';
import { getBetterAuth } from '../../../utils/better-auth-runtime';
import { completeCliLogin, failCliLogin } from '../../../utils/cli-login';

export default defineEventHandler(async event => {
    const { auth } = await getBetterAuth();
    const response = await auth.handler(toWebRequest(event));
    const headers = new Headers(response.headers);
    const token = headers.get('set-auth-token');
    headers.delete('set-auth-token');
    const location = headers.get('location');
    if (!location || response.status !== 302) return new Response(response.body, { status: response.status, headers });

    const target = new URL(location, auth.options.baseURL as string);
    if (target.pathname + target.hash === electronAuthCompletion) {
        removeBrowserSessionCookie(headers, response);
        headers.set('cache-control', 'no-store');
        headers.set('referrer-policy', 'no-referrer');
        return new Response(null, { status: 302, headers });
    }
    if (target.pathname !== '/api/auth/cli/finish') return new Response(null, { status: 302, headers });

    headers.set('cache-control', 'no-store');
    headers.set('referrer-policy', 'no-referrer');
    const state = target.searchParams.get('state');
    const hasError = target.searchParams.has('error');
    const completed = Boolean(token) && !hasError;
    const settled = token && !hasError ? completeCliLogin(state, token) : failCliLogin(state);
    if (!settled) {
        return new Response('ログイン要求が無効または期限切れです。', { status: 400, headers: {
            'cache-control': 'no-store', 'referrer-policy': 'no-referrer'
        } });
    }
    removeBrowserSessionCookie(headers, response);
    headers.set('location', `/api/auth/cli/result?status=${completed ? 'success' : 'failed'}`);
    return new Response(null, { status: 302, headers });
});

function removeBrowserSessionCookie(headers: Headers, response: Response) {
    // デスクトップと CLI の認証で既存のブラウザーセッションを上書きしない。
    headers.delete('set-cookie');
    for (const cookie of response.headers.getSetCookie()) {
        if (!/^(?:__Secure-)?better-auth\.session_token=/.test(cookie)) headers.append('set-cookie', cookie);
    }
}
