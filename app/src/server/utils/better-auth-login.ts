import { createError } from 'h3';
import { getBetterAuth } from './better-auth-runtime';
import { confirmCliLogin } from './cli-login';

export function parseLoginState(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
        throw createError({ statusCode: 400, message: 'ログイン要求が無効です。' });
    }
    return value;
}

export async function beginGoogleLogin(state?: string, requestOrigin?: string, confirmationCode?: unknown) {
    const { auth } = await getBetterAuth();
    const origin = new URL(auth.options.baseURL as string).origin;
    if (state && requestOrigin !== origin) throw createError({ statusCode: 403 });
    if (state && !confirmCliLogin(state, confirmationCode)) {
        throw createError({ statusCode: 400, message: '確認コードが一致しないか、ログイン要求が期限切れです。' });
    }

    const response = await auth.api.signInSocial({
        body: {
            provider: 'google',
            callbackURL: state ? `/api/auth/cli/finish?state=${state}` : '/',
            errorCallbackURL: '/'
        },
        headers: new Headers({ origin }),
        asResponse: true
    });
    if (!response.ok) return response;

    const { url } = await response.json() as { url?: string };
    if (!url) throw createError({ statusCode: 502, message: 'Google ログインを開始できません。' });
    const headers = new Headers({ location: url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    for (const cookie of response.headers.getSetCookie()) headers.append('set-cookie', cookie);
    return new Response(null, { status: 302, headers });
}
