import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { USERS_FILE_PATH } from './paths';

export interface Identity {
    provider: string;
    providerUserId: string;
    email: string;
}

export interface User {
    id: string; // 内部ユーザーID
    role: string;
    createdAt?: string;
    identities: Identity[];
}

interface UsersConfig {
    users: User[];
}

// users.jsonを読み込む関数
export function readUsersConfig(): UsersConfig {
    try {
        if (!fs.existsSync(USERS_FILE_PATH)) {
            return { users: [] };
        }
        const data = fs.readFileSync(USERS_FILE_PATH, 'utf8');
        const parsed = JSON.parse(data);

        // 旧形式 allowedUsers が存在する場合のマイグレーション処理
        if (parsed.allowedUsers && !parsed.users) {
            const migratedUsers: User[] = parsed.allowedUsers.map((oldUser: any) => {
                const internalId = oldUser.sub === 'local-dev-bypass'
                    ? 'usr_local_dev_bypass'
                    : `usr_${crypto.randomBytes(8).toString('hex')}`;

                const identities: Identity[] = [];
                if (oldUser.email) {
                    identities.push({
                        provider: 'google',
                        providerUserId: oldUser.sub || '',
                        email: oldUser.email
                    });
                }

                return {
                    id: internalId,
                    role: oldUser.role || 'user',
                    createdAt: new Date().toISOString(),
                    identities
                };
            });
            const newConfig = { users: migratedUsers };
            writeUsersConfig(newConfig);
            console.log('[Auth] users.json を新形式（内部ユーザーID仲介モデル）にマイグレーションしました。');
            return newConfig;
        }

        return parsed as UsersConfig;
    } catch (error) {
        console.error('users.jsonの読み込みに失敗しました:', error);
        return { users: [] };
    }
}

// users.jsonを書き込む関数
export function writeUsersConfig(config: UsersConfig): void {
    try {
        fs.writeFileSync(USERS_FILE_PATH, JSON.stringify(config, null, 2), 'utf8');
    } catch (error) {
        console.error('users.jsonの書き込みに失敗しました:', error);
    }
}

export function matchGoogleUser(sub: string, profileEmail: string, emailVerified: boolean): User | undefined {
    if (emailVerified !== true || !sub || typeof profileEmail !== 'string') {
        return undefined;
    }

    const email = profileEmail.toLowerCase();


    // 3. ユーザー設定の読み込みと認証・アクティベーション処理
    const config = readUsersConfig();

    // providerUserId が Google sub と一致するユーザーを検索
    const matchedUser = config.users.find(u =>
        u.identities.some(ident => ident.provider === 'google' && ident.providerUserId === sub)
    );

    if (matchedUser) {
        return matchedUser;
    }

    // subが一致しない場合、emailが一致し且つsubが未紐付け(空)のユーザーを探す
    const emailMatchedUser = config.users.find(u =>
        u.identities.some(ident =>
            ident.provider === 'google' &&
            ident.email.toLowerCase() === email &&
            (!ident.providerUserId || ident.providerUserId.trim() === '')
        )
    );

    if (emailMatchedUser) {
        // 初回ログイン時のアクティベーション（subの自動紐付け）
        const googleIdent = emailMatchedUser.identities.find(ident =>
            ident.provider === 'google' && !ident.providerUserId?.trim() && ident.email.toLowerCase() === email
        );
        if (googleIdent) {
            googleIdent.providerUserId = sub;
            writeUsersConfig(config);

            return emailMatchedUser;
        }
    }

    return undefined;
}
