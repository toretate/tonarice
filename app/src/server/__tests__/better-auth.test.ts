import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import { createApp, createRouter, toWebHandler } from 'h3';
import { initializeBetterAuth } from '../utils/better-auth';
import desktopLogin from '../api/auth/electron/login.get';
import googleCallback from '../api/auth/callback/google.get';

const { getBetterAuth } = vi.hoisted(() => ({ getBetterAuth: vi.fn() }));
vi.mock('../utils/better-auth-runtime', () => ({ getBetterAuth }));

it('initializeBetterAuth 認証スキーマを作成して再初期化できる', async () => {
    const database = new Database(':memory:');
    const options = {
        database,
        baseURL: 'http://localhost:3000',
        secret: 'test-only-better-auth-secret-for-memory-database',
        google: { clientId: 'test-client', clientSecret: 'test-secret' }
    };

    try {
        await initializeBetterAuth(options);
        const auth = await initializeBetterAuth(options);

        const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all();
        expect(tables).toEqual(expect.arrayContaining(['user', 'account', 'session', 'verification']));
        await expect(auth.api.getSession({ headers: new Headers() })).resolves.toBeNull();
    } finally {
        database.close();
    }
});


it('initializeBetterAuth Google OAuth の開始とコールバックでセッションを発行・失効できる', async () => {
    const database = new Database(':memory:');
    const baseURL = 'http://localhost:3000';
    const google = { clientId: 'test-client', clientSecret: 'test-secret' };
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
    let claims = { sub: 'google-sub', email: 'user@example.test', email_verified: true };
    let allowed = true;

    vi.stubGlobal('fetch', async (input: URL | Request | string) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
        if (url === 'https://oauth2.googleapis.com/token') {
            const now = Math.floor(Date.now() / 1000);
            const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
            const data = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode({
                ...claims, name: 'Test User', iss: 'https://accounts.google.com', aud: google.clientId, iat: now, exp: now + 60
            })}`;
            const signature = sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
            return Response.json({ access_token: 'test-access', token_type: 'Bearer', id_token: `${data}.${signature}` });
        }
        throw new Error('想定外の外部リクエストです。');
    });

    try {
        const auth = await initializeBetterAuth({
            database, baseURL, secret: 'test-only-better-auth-secret-for-memory-database', google,
            authorizeGoogle: profile => allowed && profile.sub === 'google-sub' && profile.email_verified,
            authorizeSession: userId => allowed && !!database.prepare('SELECT id FROM account WHERE userId = ?').get(userId)
        });

        getBetterAuth.mockResolvedValue({ auth });
        const desktopHandler = toWebHandler(createApp().use(createRouter()
            .get('/api/auth/electron/login', desktopLogin)
            .get('/api/auth/callback/google', googleCallback)));
        const signIn = async (query?: { client_id: string; code_challenge: string; state: string }) => {
            const response = query
                ? await desktopHandler(new Request(baseURL + '/api/auth/electron/login?' + new URLSearchParams(query)))
                : await auth.api.signInSocial({
                    body: { provider: 'google', callbackURL: '/done' },
                    headers: new Headers({ origin: baseURL }),
                    asResponse: true
                });
            const url = query ? response.headers.get('location') : (await response.json()).url;
            expect(url).toBeTruthy();
            const params = new URL(url).searchParams;
            expect(params.get('code_challenge_method')).toBe('S256');
            expect(params.get('state')).toBeTruthy();

            const target = new URL('/api/auth/callback/google', baseURL);
            target.searchParams.set('state', params.get('state')!);
            target.searchParams.set('code', 'test-code');
            const cookie = response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
            const callback = new Request(target, { headers: { cookie } });
            return query ? desktopHandler(callback) : auth.handler(callback);
        };

        const missingState = await auth.handler(new Request(`${baseURL}/api/auth/callback/google?code=test-code`));
        expect(missingState.headers.get('set-auth-token')).toBeNull();

        const response = await signIn();
        expect(response.headers.get('location')).toMatch(/\/done$/);
        expect(database.prepare('SELECT accessToken, refreshToken, idToken FROM account').get()).toEqual({
            accessToken: null, refreshToken: null, idToken: null
        });
        const token = response.headers.get('set-auth-token');
        expect(token).toBeTruthy();
        const headers = new Headers({ authorization: `Bearer ${token}` });
        expect((await auth.api.getSession({ headers }))?.user.email).toBe(claims.email);
        await auth.api.signOut({ headers });
        await expect(auth.api.getSession({ headers })).resolves.toBeNull();

        const verifier = 'v'.repeat(43);
        const desktopState = 'S'.repeat(16);
        const desktopCallback = await signIn({
            client_id: 'electron',
            code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            state: desktopState
        });
        expect(desktopCallback.headers.get('location')).toMatch(/#electron-auth$/);
        expect(desktopCallback.headers.getSetCookie().some(cookie => cookie.startsWith('better-auth.session_token='))).toBe(false);
        const handoff = desktopCallback.headers.getSetCookie()
            .find(cookie => cookie.startsWith('better-auth.electron='));
        expect(handoff).toBeDefined();
        const encoded = handoff!.split(';', 1)[0]!.slice('better-auth.electron='.length);
        const { identifier } = JSON.parse(Buffer.from(decodeURIComponent(encoded), 'base64url').toString('utf8'));
        const exchange = () => auth.handler(new Request(baseURL + '/api/auth/electron/token', {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: 'com.toretate.tonarice:/' },
            body: JSON.stringify({ token: identifier, state: desktopState, code_verifier: verifier })
        }));
        const desktop = await exchange();
        expect(desktop.status).toBe(200);
        expect(desktop.headers.get('set-auth-token')).toBeTruthy();
        expect((await exchange()).ok).toBe(false);

        claims = { ...claims, sub: 'unlisted-sub', email: 'unlisted@example.test' };
        const rejected = await signIn();
        expect(rejected.headers.get('set-auth-token')).toBeNull();
        expect(database.prepare('SELECT count(*) AS total FROM account').get()).toEqual({ total: 1 });
    } finally {
        vi.unstubAllGlobals();
        database.close();
    }
});
