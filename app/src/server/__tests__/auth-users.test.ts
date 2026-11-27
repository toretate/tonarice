import { beforeEach, expect, it, vi } from 'vitest';
import { matchGoogleUser } from '../utils/auth-users';

const files = vi.hoisted(() => ({ contents: '' }));
vi.mock('../utils/paths', () => ({ USERS_FILE_PATH: 'mock-users.json' }));
vi.mock('node:fs', () => ({
    existsSync: () => true,
    readFileSync: () => files.contents,
    writeFileSync: (_path: string, value: string) => { files.contents = value; }
}));

beforeEach(() => {
    files.contents = JSON.stringify({
        users: [{
            id: 'existing-user',
            role: 'admin',
            identities: [{ provider: 'google', providerUserId: '', email: 'allowed@example.test' }]
        }]
    });
});

it('matchGoogleUser 確認済みメールを初回だけ紐付けて既存の内部IDとロールを返す', () => {
    const user = matchGoogleUser('google-sub', 'Allowed@example.test', true);
    expect(user).toMatchObject({ id: 'existing-user', role: 'admin' });
    expect(matchGoogleUser('google-sub', 'changed@example.test', true)?.id).toBe('existing-user');
    expect(matchGoogleUser('different-sub', 'allowed@example.test', true)).toBeUndefined();
});

it('matchGoogleUser 未確認メールと許可リスト外のプロフィールを拒否する', () => {
    expect(matchGoogleUser('google-sub', 'allowed@example.test', false)).toBeUndefined();
    expect(matchGoogleUser('google-sub', 'unknown@example.test', true)).toBeUndefined();
    expect(JSON.parse(files.contents).users[0].identities[0].providerUserId).toBe('');
});
