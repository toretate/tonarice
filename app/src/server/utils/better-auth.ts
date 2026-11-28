import { electron } from '@better-auth/electron';
import { electronAuthScheme } from '../../utils/electron-auth-protocol';
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
        trustedOrigins: [`${electronAuthScheme}:/`],
        plugins: [electron(), bearer({ requireSignature: true })],
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
        user: authorizeGoogle ? {
            // OAuth コールバックの errorCallbackURL へリダイレクトされる検証経路で許可リストを強制する。
            validateUserInfo: ({ source }) => {
                if (source.method !== 'oauth' || source.oauth?.providerId !== 'google') return;
                const profile = source.oauth.profile;
                const sub = typeof profile?.sub === 'string' ? profile.sub : '';
                const email = typeof profile?.email === 'string' ? profile.email : '';
                const emailVerified = profile?.email_verified === true;
                if (!sub || !email || !authorizeGoogle({ sub, email, email_verified: emailVerified })) {
                    return { error: 'access_denied' };
                }
            }
        } : undefined,
        socialProviders: {
            google: {
                ...google,
                // 許可リストを検証できる構成でのみ登録する。
                disableSignUp: !authorizeGoogle,
                disableIdTokenSignIn: true,
                requireEmailVerification: true
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
