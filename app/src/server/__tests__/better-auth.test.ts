import { generateKeyPairSync, sign } from 'node:crypto';
import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import { initializeBetterAuth } from '../utils/better-auth';

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

        const signIn = async () => {
            const response = await auth.api.signInSocial({
                body: { provider: 'google', callbackURL: '/done' },
                headers: new Headers({ origin: baseURL }),
                asResponse: true
            });
            const { url } = await response.json();
            const params = new URL(url).searchParams;
            expect(params.get('code_challenge_method')).toBe('S256');
            expect(params.get('state')).toBeTruthy();

            const target = new URL('/api/auth/callback/google', baseURL);
            target.searchParams.set('state', params.get('state')!);
            target.searchParams.set('code', 'test-code');
            const cookie = response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
            return auth.handler(new Request(target, { headers: { cookie } }));
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

        claims = { ...claims, sub: 'unlisted-sub', email: 'unlisted@example.test' };
        const rejected = await signIn();
        expect(rejected.headers.get('set-auth-token')).toBeNull();
        expect(database.prepare('SELECT count(*) AS total FROM account').get()).toEqual({ total: 1 });
    } finally {
        vi.unstubAllGlobals();
        database.close();
    }
});
