import { afterAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const fixture = vi.hoisted(() => ({ root: '' }));
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getQuery: (event: any) => event.query,
    setHeader: vi.fn(),
    createError: ({ statusCode }: { statusCode: number }) => Object.assign(new Error('request failed'), { statusCode })
}));
vi.mock('../../utils/paths', () => ({ get APP_ROOT() { return fixture.root; } }));
import handler from './cli-prompts.get';

fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'tonarice-cli-prompts-'));
afterAll(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

describe('CLI のマスコットプロンプト', () => {
    it('handler_既存のファイルを返し不足分を作成しない', () => {
        const dir = path.join(fixture.root, 'mascots', 'm1');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'soul.md'), '親切', 'utf8');
        const result = (handler as any)({ context: { user: { id: 'user' } }, query: { mascotId: 'm1' } });
        expect(result.prompts.soul).toBe('親切');
        expect(result.prompts.memory).toBe('');
        expect(fs.existsSync(path.join(dir, 'memory.md'))).toBe(false);
    });

    it('handler_未認証と不正なIDを拒否する', () => {
        expect(() => (handler as any)({ context: {}, query: { mascotId: 'm1' } })).toThrow();
        expect(() => (handler as any)({ context: { user: { id: 'user' } }, query: { mascotId: '../secret' } })).toThrow();
    });
});
