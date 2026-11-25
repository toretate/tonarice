import { afterAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const fixture = vi.hoisted(() => ({ root: '' }));
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: async (event: any) => event.body,
    createError: ({ statusCode }: { statusCode: number }) => Object.assign(new Error('request failed'), { statusCode })
}));
vi.mock('../../utils/paths', () => ({ get USERS_DIR() { return fixture.root; } }));
import handler from './cli.post';
import { applyMascotCliSettings } from '../../utils/mascot-cli-settings';

fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'tonarice-mascot-api-'));
afterAll(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

describe('CLIマスコットAPI', () => {
    it('handler_作成と更新でYAMLにプロフィールとモデルを保存する', async () => {
        const send = (body: object) => (handler as any)({ context: { user: { id: 'user1' } }, body });
        const created = await send({ action: 'create', name: 'ミカ' });
        const id = created.mascot.id;
        await send({ action: 'profile', id, profile: '元気' });
        await send({ action: 'model', id, engine: 'openai', model: 'model-a' });
        const dir = path.join(fixture.root, 'user1', 'mascots', id);
        const json = JSON.parse(fs.readFileSync(path.join(dir, 'mascot_config.json'), 'utf8'));
        const result = applyMascotCliSettings(dir, json);
        expect(result.profile).toBe('元気');
        expect(result.aiConfig.chat).toMatchObject({ engine: 'openai', model: 'model-a' });
        expect(fs.existsSync(path.join(dir, 'config.yaml'))).toBe(true);
    });

    it('handler_不正なIDを拒否する', async () => {
        await expect((handler as any)({ context: { user: { id: 'user1' } }, body: { action: 'profile', id: '../other', profile: 'x' } })).rejects.toMatchObject({ statusCode: 400 });
    });
});
