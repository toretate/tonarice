import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CliError, parseArgs, resolveDefaultUrl } from './main.js';

describe('CLI 接続先解決', () => {
    it('resolveDefaultUrl_環境変数の優先順位に従って既定URLを決定する', () => {
        assert.equal(resolveDefaultUrl({}), 'http://localhost:3000');
        assert.equal(resolveDefaultUrl({ PORT: '3005' }), 'http://localhost:3005');
        assert.equal(resolveDefaultUrl({ PORT: '3005', TONARICE_PORT: '3010' }), 'http://localhost:3010');
        assert.equal(
            resolveDefaultUrl({ PORT: '3005', TONARICE_PORT: '3010', TONARICE_CLI_URL: 'http://127.0.0.1:3020' }),
            'http://127.0.0.1:3020'
        );
    });

    it('resolveDefaultUrl_不正なポートまたはURL環境変数を拒否する', () => {
        assert.throws(() => resolveDefaultUrl({ TONARICE_PORT: 'invalid' }), (err) => err instanceof CliError && err.code === 'invalid_input' && err.exitCode === 2);
        assert.throws(() => resolveDefaultUrl({ TONARICE_PORT: '70000' }), (err) => err instanceof CliError && err.code === 'invalid_input' && err.exitCode === 2);
        assert.throws(() => resolveDefaultUrl({ TONARICE_CLI_URL: 'http://localhost:3010/path' }), (err) => err instanceof CliError && err.code === 'invalid_input' && err.exitCode === 2);
    });

    it('parseArgs_urlオプション未指定時は環境変数を使い明示指定時は引数を優先する', () => {
        const fromEnv = parseArgs(['ping'], { TONARICE_PORT: '3010' });
        assert.equal(fromEnv.url, 'http://localhost:3010');

        const fromArg = parseArgs(['ping', '--url', 'http://127.0.0.1:3099'], { TONARICE_PORT: 'invalid' });
        assert.equal(fromArg.url, 'http://127.0.0.1:3099');
    });
});
