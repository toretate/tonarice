import { APIError } from 'better-auth/api';
import { bearer } from 'better-auth/plugins';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import type Database from 'better-sqlite3';

interface AuthOptions {
    database: Database.Database;
    baseURL: string;
    secret: string;
    google: { clientId: string; clientSecret: string };
    authorizeGoogle?: (profile: { sub: string; email: string; email_verified: boolean }) => boolean;
    authorizeSession?: (userId: string) => boolean;
}

export async function initializeBetterAuth({ database, baseURL, secret, google, authorizeGoogle, authorizeSession }: AuthOptions) {
    const auth = betterAuth({
        appName: 'tonarice',
        database,
        baseURL,
        secret,
        plugins: [bearer({ requireSignature: true })],
        session: { cookieCache: { enabled: false } },
        logger: {
            level: 'warn',
            log: level => console.warn(`[Auth] Better Auth が ${level} を報告しました。`)
        },
        databaseHooks: {
            account: {
                create: {
                    before: async () => ({
                        data: {
                            accessToken: null,
                            refreshToken: null,
                            idToken: null,
                            accessTokenExpiresAt: null,
                            refreshTokenExpiresAt: null
                        }
                    })
                }
            },
            session: {
                create: {
                    before: async session => {
                        if (authorizeSession && !authorizeSession(session.userId)) return false;
                    }
                }
            }
        },
        socialProviders: {
            google: {
                ...google,
                // 許可リストを検証できる構成でのみ登録する。
                disableSignUp: !authorizeGoogle,
                disableIdTokenSignIn: true,
                requireEmailVerification: true,
                mapProfileToUser: profile => {
                    if (authorizeGoogle && !authorizeGoogle(profile)) {
                        throw new APIError('FORBIDDEN', { message: 'アクセスが許可されていません。' });
                    }
                    return {};
                }
            }
        },
        account: {
            accountLinking: { enabled: false },
            updateAccountOnSignIn: false
        }
    });

    const migrations = await getMigrations(auth.options, { throwOnUnsafe: true });
    await migrations.runMigrations();
    return auth;
}
