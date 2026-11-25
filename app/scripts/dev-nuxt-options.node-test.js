import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    assertPortAvailable,
    prepareIsolatedStorage,
    resolveDevNuxtOptions,
    resolveServerPort
} from './dev-nuxt-options.js';

describe('dev-nuxt-options', () => {
    it('resolveServerPort_TONARICE_PORTをPORTより優先して解決する', () => {
        assert.equal(resolveServerPort({}), null);
        assert.equal(resolveServerPort({ PORT: '3005' }), 3005);
        assert.equal(resolveServerPort({ PORT: '3005', TONARICE_PORT: '3010' }), 3010);
    });

    it('resolveServerPort_不正なポート環境変数を拒否する', () => {
        assert.throws(() => resolveServerPort({ TONARICE_PORT: 'abc' }));
        assert.throws(() => resolveServerPort({ TONARICE_PORT: '0' }));
        assert.throws(() => resolveServerPort({ PORT: '70000' }));
    });

    it('resolveDevNuxtOptions_環境変数のポートをNuxt引数へ付与し明示引数を優先する', () => {
        const fromEnv = resolveDevNuxtOptions([], 'C:/work/app', { TONARICE_PORT: '3010' });
        assert.deepEqual(fromEnv.nuxtArgs, ['--port', '3010']);
        assert.equal(fromEnv.port, 3010);
        assert.equal(fromEnv.childEnv.PORT, '3010');
        assert.equal(fromEnv.childEnv.NITRO_PORT, '3010');
        assert.equal(fromEnv.trackProcessFile, true);

        const explicit = resolveDevNuxtOptions(['--port', '3020'], 'C:/work/app', { TONARICE_PORT: '3010' });
        assert.deepEqual(explicit.nuxtArgs, ['--port', '3020']);
        assert.equal(explicit.port, 3020);
        assert.equal(explicit.childEnv.PORT, '3020');
        assert.equal(explicit.childEnv.NITRO_PORT, '3020');
    });

    it('resolveDevNuxtOptions_隔離ストレージ起動時にポート未指定を拒否し明示ポートを必須にする', () => {
        assert.throws(
            () => resolveDevNuxtOptions(['--isolated-storage'], 'C:/work/app', {}),
            /ポートの明示指定が必要/
        );
        const withArg = resolveDevNuxtOptions(['--isolated-storage', '--port', '3015'], 'C:/work/app', {});
        assert.equal(withArg.port, 3015);
        assert.deepEqual(withArg.nuxtArgs, ['--port', '3015']);

        const withShortArg = resolveDevNuxtOptions(['--isolated-storage', '-p', '3016'], 'C:/work/app', {});
        assert.equal(withShortArg.port, 3016);
    });

    it('resolveDevNuxtOptions_隔離ストレージオプションを解析してNuxt引数から除外する', () => {
        const auto = resolveDevNuxtOptions(['--isolated-storage', '--host', '127.0.0.1'], 'C:/work/app', { TONARICE_PORT: '3010' });
        assert.deepEqual(auto.nuxtArgs, ['--host', '127.0.0.1', '--port', '3010']);
        assert.equal(auto.host, '127.0.0.1');
        assert.deepEqual(auto.isolatedStorage, { dir: '', autoCleanup: true });
        assert.equal(auto.trackProcessFile, false);

        const named = resolveDevNuxtOptions(['--isolated-storage', './tmp-store', '--port=3011'], 'C:/work/app', {});
        assert.deepEqual(named.nuxtArgs, ['--port=3011']);
        assert.equal(named.isolatedStorage.dir, path.resolve('C:/work/app', './tmp-store'));
        assert.equal(named.isolatedStorage.autoCleanup, false);

        const equalsForm = resolveDevNuxtOptions(['--isolated-storage=./tmp-eq'], 'C:/work/app', { PORT: '3012' });
        assert.equal(equalsForm.isolatedStorage.dir, path.resolve('C:/work/app', './tmp-eq'));
        assert.equal(equalsForm.isolatedStorage.autoCleanup, false);
    });

    it('resolveDevNuxtOptions_不正または重複した隔離ストレージ指定や不正ポート引数を拒否する', () => {
        assert.throws(() => resolveDevNuxtOptions(['--isolated-storage='], 'C:/work/app', { PORT: '3010' }));
        assert.throws(() => resolveDevNuxtOptions(['--isolated-storage', '--isolated-storage'], 'C:/work/app', { PORT: '3010' }));
        assert.throws(() => resolveDevNuxtOptions(['--port', 'abc'], 'C:/work/app', {}));
        assert.throws(() => resolveDevNuxtOptions(['--port'], 'C:/work/app', {}));
    });

    it('prepareIsolatedStorage_一時ディレクトリを作成してMASCOT_STORAGE_DIRを上書きする', () => {
        const base = resolveDevNuxtOptions(['--isolated-storage', '--port', '3010'], 'C:/work/app', { MASCOT_STORAGE_DIR: 'C:/shared/storage' });
        const prepared = prepareIsolatedStorage(base);
        try {
            assert.ok(prepared.isolatedStorage.dir.startsWith(os.tmpdir()));
            assert.equal(fs.existsSync(prepared.isolatedStorage.dir), true);
            assert.equal(prepared.childEnv.MASCOT_STORAGE_DIR, prepared.isolatedStorage.dir);
            assert.notEqual(prepared.childEnv.MASCOT_STORAGE_DIR, 'C:/shared/storage');
        } finally {
            fs.rmSync(prepared.isolatedStorage.dir, { recursive: true, force: true });
        }
    });

    it('assertPortAvailable_使用中ポートでは別ポートへ移らず失敗し空きポートでは成功する', async () => {
        const blocker = net.createServer();
        await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
        const occupiedPort = blocker.address().port;
        try {
            await assert.rejects(
                () => assertPortAvailable(occupiedPort, '127.0.0.1'),
                /既に使用中/
            );
            await assert.rejects(
                () => assertPortAvailable(occupiedPort, null),
                /既に使用中/
            );

            // dev-nuxt.js 実プロセスでも占有ポートを拒否し隔離ディレクトリを残さず失敗すること
            const explicitIsoDir = path.join(os.tmpdir(), `tonarice-occupied-test-${Date.now()}`);
            const result = spawnSync(
                process.execPath,
                ['scripts/dev-nuxt.js', '--isolated-storage', explicitIsoDir, '--port', String(occupiedPort)],
                { encoding: 'utf8' }
            );
            assert.equal(result.status, 2);
            assert.match(result.stderr, /既に使用中/);
            assert.equal(fs.existsSync(explicitIsoDir), false);
        } finally {
            await new Promise((resolve) => blocker.close(resolve));
        }

        await assert.doesNotReject(() => assertPortAvailable(occupiedPort, '127.0.0.1'));
    });
});
