import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const fixture = vi.hoisted(() => ({ appRoot: '', usersDir: '', bypass: false }));
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getQuery: (event: any) => event.query,
    readBody: async (event: any) => event.body,
    setHeader: vi.fn(),
    createError: ({ statusCode }: { statusCode: number }) => Object.assign(new Error('request failed'), { statusCode })
}));
vi.mock('../../utils/paths', () => ({
    get APP_ROOT() { return fixture.appRoot; },
    get USERS_DIR() { return fixture.usersDir; }
}));
vi.mock('../../utils/auth-bypass', () => ({
    isAuthBypassAllowed: () => fixture.bypass
}));
import handler from './cli-prompts.get';
import postHandler from './cli-prompts.post';

const baseTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tonarice-cli-prompts-'));
fixture.appRoot = path.join(baseTmp, 'app');
fixture.usersDir = path.join(baseTmp, 'storage', 'users');
afterAll(() => fs.rmSync(baseTmp, { recursive: true, force: true }));

function createOwnedMascot(userId: string, mascotId: string) {
    const dir = path.join(fixture.usersDir, userId, 'mascots', mascotId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mascot_config.json'), JSON.stringify({ id: mascotId, name: 'テスト' }), 'utf8');
    return dir;
}

describe('CLI のマスコットプロンプトとアクセス制御', () => {
    beforeEach(() => {
        fixture.bypass = false;
        fs.rmSync(fixture.appRoot, { recursive: true, force: true });
        fs.rmSync(fixture.usersDir, { recursive: true, force: true });
        fs.mkdirSync(fixture.appRoot, { recursive: true });
        fs.mkdirSync(fixture.usersDir, { recursive: true });
    });

    it('handler_所有ユーザーの個別プロンプトを返し不足分を作成しない', () => {
        const dir = createOwnedMascot('userA', 'm1');
        fs.writeFileSync(path.join(dir, 'soul.md'), '親切', 'utf8');
        const result = (handler as any)({ context: { user: { id: 'userA' } }, query: { mascotId: 'm1' } });
        expect(result.prompts.soul).toBe('親切');
        expect(result.prompts.memory).toBe('');
        expect(fs.existsSync(path.join(dir, 'memory.md'))).toBe(false);
    });

    it('handler_他ユーザーが所有するマスコットIDは404で拒否する', () => {
        const dirA = createOwnedMascot('userA', 'm_secret');
        fs.writeFileSync(path.join(dirA, 'user.md'), 'ユーザーAの個人情報', 'utf8');
        fs.writeFileSync(path.join(dirA, 'memory.md'), '秘密の記憶', 'utf8');

        expect(() => (handler as any)({
            context: { user: { id: 'userB' } },
            query: { mascotId: 'm_secret' }
        })).toThrow(expect.objectContaining({ statusCode: 404 }));
    });

    it('handler_複数ユーザー環境では共有APP_ROOT配下の未移行プロンプトを返さない', () => {
        fixture.bypass = false;
        createOwnedMascot('userB', 'shared_id');
        const legacyDir = path.join(fixture.appRoot, 'mascots', 'shared_id');
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'user.md'), '共有ディレクトリの個人情報', 'utf8');
        fs.writeFileSync(path.join(legacyDir, 'memory.md'), '共有ディレクトリの記憶', 'utf8');

        const result = (handler as any)({ context: { user: { id: 'userB' } }, query: { mascotId: 'shared_id' } });
        expect(result.prompts.user).toBe('');
        expect(result.prompts.memory).toBe('');
    });

    it('handler_単一ローカル開発バイパス時は所有確認後にユーザー別を優先し未移行分のみ共有へ互換フォールバックする', () => {
        fixture.bypass = true;
        const userDir = createOwnedMascot('usr_local_dev_bypass', 'm_local');
        fs.writeFileSync(path.join(userDir, 'soul.md'), 'ユーザー別ソウル', 'utf8');

        const legacyDir = path.join(fixture.appRoot, 'mascots', 'm_local');
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'soul.md'), '旧共有ソウル', 'utf8');
        fs.writeFileSync(path.join(legacyDir, 'user.md'), '旧共有ユーザー設定', 'utf8');

        const result = (handler as any)({
            context: { user: { id: 'usr_local_dev_bypass' } },
            query: { mascotId: 'm_local' }
        });
        expect(result.prompts.soul).toBe('ユーザー別ソウル');
        expect(result.prompts.user).toBe('旧共有ユーザー設定');
        expect(result.prompts.memory).toBe('');

        // ローカル開発バイパスでも所有していない ID は 404 で拒否する
        const unownedLegacyDir = path.join(fixture.appRoot, 'mascots', 'unowned');
        fs.mkdirSync(unownedLegacyDir, { recursive: true });
        fs.writeFileSync(path.join(unownedLegacyDir, 'user.md'), '未所有データ', 'utf8');
        expect(() => (handler as any)({
            context: { user: { id: 'usr_local_dev_bypass' } },
            query: { mascotId: 'unowned' }
        })).toThrow(expect.objectContaining({ statusCode: 404 }));
    });

    it('handler_未認証と不正なIDを拒否する', () => {
        expect(() => (handler as any)({ context: {}, query: { mascotId: 'm1' } })).toThrow(expect.objectContaining({ statusCode: 401 }));
        expect(() => (handler as any)({ context: { user: { id: 'userA' } }, query: { mascotId: '../secret' } })).toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    it('postHandler_所有ユーザーの個別保存先へプロンプトを保存し共有APP_ROOTへ書き込まない', async () => {
        const dirA = createOwnedMascot('userA', 'm1');
        const saved = await (postHandler as any)({
            context: { user: { id: 'userA' } },
            body: {
                mascotId: 'm1',
                prompts: { identity: 'ID', soul: '元気', user: 'マスター', agents: 'ルール', memory: '記憶' }
            }
        });
        expect(saved.success).toBe(true);
        expect(fs.readFileSync(path.join(dirA, 'user.md'), 'utf8')).toBe('マスター');
        expect(fs.existsSync(path.join(fixture.appRoot, 'mascots', 'm1', 'user.md'))).toBe(false);

        const loaded = (handler as any)({ context: { user: { id: 'userA' } }, query: { mascotId: 'm1' } });
        expect(loaded.prompts.memory).toBe('記憶');
    });

    it('postHandler_他ユーザーのマスコットへの保存と不正入力を拒否する', async () => {
        createOwnedMascot('userA', 'm1');
        await expect((postHandler as any)({
            context: { user: { id: 'userB' } },
            body: { mascotId: 'm1', prompts: { soul: '改ざん' } }
        })).rejects.toMatchObject({ statusCode: 404 });

        await expect((postHandler as any)({
            context: {},
            body: { mascotId: 'm1', prompts: {} }
        })).rejects.toMatchObject({ statusCode: 401 });

        await expect((postHandler as any)({
            context: { user: { id: 'userA' } },
            body: { mascotId: '../bad', prompts: {} }
        })).rejects.toMatchObject({ statusCode: 400 });
    });
});
