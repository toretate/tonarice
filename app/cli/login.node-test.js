import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { login } from './login.js';
import { createMascotClient } from './mascots.js';

describe('CLIログイン', () => {
    it('login_ブラウザー認証を待ち一度だけトークンを受け取る', async () => {
        const state = 'a'.repeat(43);
        const verifier = 'b'.repeat(43);
        let count = 0;
        let opened = '';
        let text = '';
        const token = await login({ url: 'http://127.0.0.1:3000', timeout: 500 }, { write(value) { text += value; } }, {
            fetch: async (url, request) => {
                if (url.pathname.endsWith('/start')) return Response.json({ state, verifier, confirmationCode: 'abcd1234', expiresIn: 60 });
                assert.deepEqual(JSON.parse(request.body), { state, verifier });
                return Response.json(++count === 1 ? { status: 'pending' } : { status: 'complete', token: 'private-token' });
            },
            delay: async () => {}, openBrowser: url => { opened = url; }
        });
        assert.equal(token, 'private-token');
        assert.ok(opened.includes('cli_state='));
        assert.equal(text.includes(verifier), false);
        assert.equal(text.includes(token), false);
    });

    it('login_平文の遠隔サーバーを拒否する', async () => {
        await assert.rejects(login({ url: 'http://example.com', timeout: 10 }, { write() {} }), error => error.code === 'invalid_input');
    });

    it('createMascotClient_ログイン後の認証情報を次のAPI要求で使用する', async () => {
        const env = {};
        let authorization;
        const client = createMascotClient({ url: 'http://localhost:3000', timeout: 500 }, {
            env, fetch: async (url, request) => { authorization = request.headers.Authorization; return Response.json({ success: true, mascots: [] }); }
        });
        env.TONARICE_SESSION_TOKEN = 'private-token';
        await client.list();
        assert.equal(authorization, 'Bearer private-token');
    });

    it('createMascotClient_読込の接続エラーと保存時の結果不明を区別する', async () => {
        const client = createMascotClient({ url: 'http://localhost:3000', timeout: 100 }, { env: {}, fetch: async () => { throw new Error('offline'); } });
        await assert.rejects(client.list(), error => error.message.includes('npm run dev:cli') && !error.message.includes('結果が不明'));
        await assert.rejects(client.update({ action: 'create' }), error => error.message.includes('結果が不明'));
    });
});
