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
import { readLegacyMascotPromptsReadOnly } from '../../../../electron/ipc-handlers/legacy-mascot-prompts';

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
        expect(result.configured).toBe(true);
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
        expect(result.configured).toBe(false);
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

    it('handler_明示的に空で保存された設定を未移行扱いしない', async () => {
        createOwnedMascot('userA', 'blank');
        const context = { user: { id: 'userA' } };
        await (postHandler as any)({ context, body: { mascotId: 'blank', prompts: {} } });
        expect((handler as any)({ context, query: { mascotId: 'blank' } })).toMatchObject({ configured: true, prompts: { soul: '' } });
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

    it('postHandler_記憶専用モードでmemoryのみ保存しconfiguredを確定させず他項目を維持する', async () => {
        const dirA = createOwnedMascot('userA', 'm_auto');
        const context = { user: { id: 'userA' } };

        // 新規マスコットに memory のみ初回保存しても configured は false のまま維持されること
        const first = await (postHandler as any)({
            context,
            body: { mascotId: 'm_auto', mode: 'memory', memory: '自動記憶1', expectedCurrentMemory: '' }
        });
        expect(first.success).toBe(true);
        expect(first.configured).toBe(false);
        expect(fs.existsSync(path.join(dirA, 'memory.md'))).toBe(true);
        expect(fs.existsSync(path.join(dirA, 'soul.md'))).toBe(false);
        expect((handler as any)({ context, query: { mascotId: 'm_auto' } })).toMatchObject({
            configured: false,
            prompts: { memory: '自動記憶1', soul: '' }
        });

        // 既存別項目がある状態で memory のみ更新しても別項目が保持されること
        fs.writeFileSync(path.join(dirA, 'soul.md'), '並行編集された性格', 'utf8');
        const second = await (postHandler as any)({
            context,
            body: { mascotId: 'm_auto', mode: 'memory', memory: '自動記憶2', expectedCurrentMemory: '自動記憶1' }
        });
        expect(second.configured).toBe(true);
        expect(fs.readFileSync(path.join(dirA, 'soul.md'), 'utf8')).toBe('並行編集された性格');
        expect(fs.readFileSync(path.join(dirA, 'memory.md'), 'utf8')).toBe('自動記憶2');

        // 更新前から memory が変わっていた場合は 409 で拒否し新しい内容を優先すること
        await expect((postHandler as any)({
            context,
            body: { mascotId: 'm_auto', mode: 'memory', memory: '古い自動要約', expectedCurrentMemory: '自動記憶1' }
        })).rejects.toMatchObject({ statusCode: 409 });
        expect(fs.readFileSync(path.join(dirA, 'memory.md'), 'utf8')).toBe('自動記憶2');

        // 未所有マスコットへの memory 保存は 404 で拒否すること
        await expect((postHandler as any)({
            context: { user: { id: 'userB' } },
            body: { mascotId: 'm_auto', mode: 'memory', memory: '不正書込', expectedCurrentMemory: '自動記憶2' }
        })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('readLegacyMascotPromptsReadOnly_空ディレクトリや一部ファイルの参照前後でファイルを作成しない', () => {
        const emptyDir = path.join(fixture.appRoot, 'mascots', 'empty_mascot');
        fs.mkdirSync(emptyDir, { recursive: true });
        expect(readLegacyMascotPromptsReadOnly(fixture.appRoot, 'empty_mascot')).toEqual({
            found: false,
            prompts: {}
        });
        expect(fs.readdirSync(emptyDir)).toEqual([]);

        const partialDir = path.join(fixture.appRoot, 'mascots', 'partial_mascot');
        fs.mkdirSync(partialDir, { recursive: true });
        fs.writeFileSync(path.join(partialDir, 'soul.md'), '旧ソウル', 'utf8');
        fs.writeFileSync(path.join(partialDir, 'user.md'), '', 'utf8');
        const beforeFiles = fs.readdirSync(partialDir).sort();

        const preview = readLegacyMascotPromptsReadOnly(fixture.appRoot, 'partial_mascot');
        expect(preview).toEqual({
            found: true,
            prompts: { soul: '旧ソウル', user: '' }
        });
        expect(Object.prototype.hasOwnProperty.call(preview.prompts, 'memory')).toBe(false);
        expect(fs.readdirSync(partialDir).sort()).toEqual(beforeFiles);
        expect(fs.readFileSync(path.join(partialDir, 'soul.md'), 'utf8')).toBe('旧ソウル');
    });
});
