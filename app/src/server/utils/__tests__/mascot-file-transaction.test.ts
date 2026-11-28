import { expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useMascotFiles } from '../mascot-file-transaction';

vi.mock('node:fs', async importOriginal => {
    const original = await importOriginal<typeof import('node:fs')>();
    return { ...original, renameSync: vi.fn(original.renameSync) };
});

test('useMascotFiles_Windowsの一時的なリネーム拒否を再試行して更新を確定する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tonarice-file-retry-'));
    const wait = vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out');
    try {
        vi.mocked(renameSync).mockImplementationOnce(() => {
            throw Object.assign(new Error('一時ロック'), { code: 'EPERM' });
        });
        useMascotFiles(dir, (_files, commit) => commit({ 'memory.md': '新しい記録' }));
        expect(readFileSync(join(dir, 'memory.md'), 'utf8')).toBe('新しい記録');
        expect(wait).toHaveBeenCalledOnce();
        expect(renameSync).toHaveBeenCalledTimes(3);
    } finally {
        wait.mockRestore();
        rmSync(dir, { recursive: true, force: true });
    }
});
