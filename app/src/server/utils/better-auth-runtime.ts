import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createError } from 'h3';
import { initializeBetterAuth } from './better-auth';
import { STORAGE_DIR } from './paths';
import { matchGoogleUser, readUsersConfig } from './auth-users';

async function initialize() {
    const baseURL = process.env.BETTER_AUTH_URL;
    const secret = process.env.BETTER_AUTH_SECRET;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!baseURL || !secret || secret.length < 32 || !clientId || !clientSecret) {
        throw createError({ statusCode: 503, message: '認証設定が未完了です。' });
    }

    const origin = new URL(baseURL);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (origin.origin !== baseURL.replace(/\/$/, '') ||
        (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))) {
        throw createError({ statusCode: 503, message: 'BETTER_AUTH_URL に HTTPS またはローカルのオリジンを設定してください。' });
    }
    mkdirSync(STORAGE_DIR, { recursive: true });
    const database = new Database(join(STORAGE_DIR, 'auth.sqlite'));
    try {
        database.pragma('journal_mode = WAL');
        const auth = await initializeBetterAuth({
            database, baseURL, secret, google: { clientId, clientSecret },
            authorizeGoogle: profile => !!matchGoogleUser(profile.sub, profile.email, profile.email_verified),
            authorizeSession: userId => !!findUser(userId)
        });

        function findUser(userId: string) {
            const account = database.prepare('SELECT accountId FROM account WHERE userId = ? AND providerId = ?')
                .get(userId, 'google') as { accountId: string } | undefined;
            return account && readUsersConfig().users.find(user =>
                user.identities.some(identity => identity.provider === 'google' && identity.providerUserId === account.accountId));
        }

        return { auth, findUser };
    } catch (error) {
        database.close();
        throw error;
    }
}

let runtime: ReturnType<typeof initialize> | undefined;

export function getBetterAuth() {
    return runtime ??= initialize().catch(error => {
        runtime = undefined;
        throw error;
    });
}

export async function requireBetterAuthSession(headers: Headers) {
    if (!headers.has('cookie') && !headers.has('authorization')) {
        throw createError({ statusCode: 401, message: 'ログインが必要です。' });
    }
    const { auth, findUser } = await getBetterAuth();
    const session = await auth.api.getSession({ headers, query: { disableRefresh: true } });
    if (!session) throw createError({ statusCode: 401, message: 'ログインが必要です。' });
    const user = findUser(session.user.id);
    if (!user) throw createError({ statusCode: 403, message: 'アクセスが許可されていません。' });
    return { user, session: session.session };
}
