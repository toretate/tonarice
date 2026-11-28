import { createApp, createRouter, toWebHandler } from 'h3';
import { expect, it, vi } from 'vitest';
import loginPage from '../api/auth/login.get';
import submitLogin from '../api/auth/login.post';
import { startCliLogin } from '../utils/cli-login';

const { signInSocial } = vi.hoisted(() => ({ signInSocial: vi.fn() }));
vi.mock('../utils/better-auth-runtime', () => ({
    getBetterAuth: () => ({
        auth: { options: { baseURL: 'http://localhost:3000' }, api: { signInSocial } }
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
