import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('環境変数ファイル', () => {
    it('起動_既存環境変数を優先し未設定の値を読み込む', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'tonarice-cli-env-'));
        try {
            const file = path.join(dir, '.env.local');
            await writeFile(file, 'TONARICE_TEST_EXISTING=file-value\nTONARICE_TEST_NEW=from-file\n');
            const result = spawnSync(process.execPath, [`--env-file=${file}`, '-e', "process.exit(process.env.TONARICE_TEST_EXISTING === 'from-shell' && process.env.TONARICE_TEST_NEW === 'from-file' ? 0 : 1)"], {
                env: { ...process.env, TONARICE_TEST_EXISTING: 'from-shell' }, encoding: 'utf8'
            });
            assert.equal(result.status, 0);
            assert.equal(result.stdout, '');
        } finally { await rm(dir, { recursive: true, force: true }); }
    });
});
