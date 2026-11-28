import { createApp, createRouter, toWebHandler } from 'h3';
import { expect, it, vi } from 'vitest';
import loginPage from '../api/auth/login.get';
import submitLogin from '../api/auth/login.post';
import { confirmCliLogin, startCliLogin } from '../utils/cli-login';
import googleCallback from '../api/auth/callback/google.get';
import claimLogin from '../api/auth/cli/claim.post';
import loginResult from '../api/auth/cli/result.get';

const { signInSocial, oauthCallback } = vi.hoisted(() => ({ signInSocial: vi.fn(), oauthCallback: vi.fn() }));
vi.mock('../utils/better-auth-runtime', () => ({
    getBetterAuth: () => ({
        auth: { options: { baseURL: 'http://localhost:3000' }, api: { signInSocial }, handler: oauthCallback }
    })
}));

it('ログイン確認フォーム 同一オリジンの送信からGoogle認証に進める', async () => {
    const { state, confirmationCode } = startCliLogin();
    const googleUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    signInSocial.mockResolvedValueOnce(Response.json({ url: googleUrl }, {
        headers: { 'set-cookie': 'test_oauth_state=mock; HttpOnly; Path=/' }
    }));
    const handler = toWebHandler(createApp().use(createRouter()
        .get('/api/auth/login', loginPage)
        .post('/api/auth/login', submitLogin)));

    const form = await handler(new Request(`http://localhost:3000/api/auth/login?cli_state=${state}`));
    expect(form.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(form.headers.get('content-security-policy')).toContain("form-action 'self' https://accounts.google.com;");
    const request = (origin: string) => new Request('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { origin },
        body: new URLSearchParams({ state, confirmationCode })
    });

    const denied = await handler(request('https://elsewhere.example.test'));
    expect(denied.status).toBe(403);
    expect(signInSocial).not.toHaveBeenCalled();

    const response = await handler(request('http://localhost:3000'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(googleUrl);
    expect(response.headers.get('set-cookie')).toContain('test_oauth_state=mock');
});


it.each([true, false])('CLI ログイン 結果をブラウザーと CLI に返す（成功: %s）', async success => {
    const { state, verifier, confirmationCode } = startCliLogin();
    expect(confirmCliLogin(state, confirmationCode)).toBe(true);
    const target = new URL('/api/auth/cli/finish', 'http://localhost:3000');
    target.searchParams.set('state', state);
    if (!success) target.searchParams.set('error', 'access_denied');
    const headers = new Headers({ location: target.href });
    if (success) {
        headers.set('set-auth-token', 'fixture-session');
        headers.set('set-cookie', 'better-auth.session_token=fixture-session; HttpOnly; Path=/');
    }
    oauthCallback.mockResolvedValueOnce(new Response(null, { status: 302, headers }));
    const app = toWebHandler(createApp().use(createRouter()
        .get('/api/auth/callback/google', googleCallback)
        .post('/api/auth/cli/claim', claimLogin)
        .get('/api/auth/cli/result', loginResult)));

    const callback = await app(new Request('http://localhost:3000/api/auth/callback/google'));
    expect(callback.status).toBe(302);
    expect(callback.headers.get('set-auth-token')).toBeNull();
    expect(callback.headers.get('set-cookie')).toBeNull();
    const resultURL = new URL(callback.headers.get('location')!, target.origin);
    expect(resultURL.searchParams.has('state')).toBe(false);
    const result = await app(new Request(resultURL));
    expect(await result.text()).toContain(success ? 'CLI に戻ってください' : '/login からやり直してください');

    const claim = () => app(new Request('http://localhost:3000/api/auth/cli/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state, verifier })
    }));
    expect(await (await claim()).json()).toEqual(success
        ? { status: 'complete', token: 'fixture-session' }
        : { status: 'failed' });
    expect((await claim()).status).toBe(400);
});
