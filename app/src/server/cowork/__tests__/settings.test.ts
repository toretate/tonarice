import Database from 'better-sqlite3';
import { createApp, createRouter, eventHandler, getHeader, toWebHandler } from 'h3';
import { mkdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import getSettings from '../../api/cowork/settings.get';
import saveSettings from '../../api/cowork/settings.put';
import listModels from '../../api/cowork/models.post';
import resetSettings from '../../api/cowork/settings.delete';
import { createCoWorkAgent, prepareCoWorkAgentInput } from '../../mastra/cowork-agent';
import { getDB } from '../../utils/db';
import { USERS_DIR } from '../../utils/paths';
import { getUserConfigPath } from '../../utils/user-config-path';
import { resolveCoWorkAiSettings } from '../ai-settings';
import { getCoWorkScope } from '../http';

vi.mock('../../utils/db', () => ({ getDB: vi.fn() }));
vi.mock('../../utils/paths', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    return { USERS_DIR: mkdtempSync(join(tmpdir(), 'tonarice-cowork-ai-')) };
});

const path = '/api/cowork/settings';
const origin = 'https://cowork.example.test';
const modelsPath = '/api/cowork/models';
const router = createRouter().get(path, getSettings).put(path, saveSettings).delete(path, resetSettings).post(modelsPath, listModels);
const handler = toWebHandler(createApp()
    .use(eventHandler(event => {
        const user = getHeader(event, 'x-test-user');
        if (user) event.context.user = { id: user, email: '', role: user === 'admin' ? 'admin' : 'user' };
    }))
    .use(router));
let db: ReturnType<typeof getDB>;
const fixtureOwners = ['admin', 'reader'];

function writeUserKeys(owner: string, keys: Record<string, string>) {
    mkdirSync(join(USERS_DIR, owner), { recursive: true });
    writeFileSync(getUserConfigPath(owner), JSON.stringify(keys), 'utf8');
}

function request(method: string, user?: string, body?: unknown, headers?: Record<string, string>, target = path) {
    return handler(new Request(origin + target, {
        method,
        headers: {
            'content-type': 'application/json',
            host: 'cowork.example.test',
            'x-forwarded-proto': 'https',
            ...(user && { 'x-test-user': user, 'x-cowork-scope': getCoWorkScope(user) }),
            ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    }));
}

beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE global_configs (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
    vi.mocked(getDB).mockReturnValue(db);
    for (const name of ['COWORK_AI_ENGINE', 'COWORK_AI_MODEL', 'COWORK_AI_API_KEY', 'COWORK_LMSTUDIO_ENDPOINT']) {
        vi.stubEnv(name, undefined);
    }
});

afterEach(() => {
    db.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    for (const owner of fixtureOwners) {
        rmSync(getUserConfigPath(owner), { force: true });
    }
});

afterAll(() => {
    for (const owner of fixtureOwners) {
        const userDir = join(USERS_DIR, owner);
        try { rmdirSync(userDir); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
    }
    rmdirSync(USERS_DIR);
});

describe('CoWork AI 設定 API', () => {
    it('設定取得_認証を要求しAPIキーの値を返さない', async () => {
        vi.stubEnv('COWORK_AI_ENGINE', 'gemini');
        vi.stubEnv('COWORK_AI_MODEL', 'test-model');
        vi.stubEnv('COWORK_AI_API_KEY', 'fixture-environment-key');

        expect((await request('GET')).status).toBe(401);
        const response = await request('GET', 'reader');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({
            engine: 'gemini', model: 'test-model', source: 'environment', hasApiKey: true, configured: true
        });
    });

    it('設定保存_一般ユーザーが自分のモデルを保存してメイン設定のキーを使える', async () => {
        writeUserKeys('admin', { googleAiStudioApiKey: 'fixture-admin-gemini-key' });
        writeUserKeys('reader', { googleAiStudioApiKey: 'fixture-reader-gemini-key', openaiApiKey: 'fixture-reader-openai-key' });
        const input = { engine: 'gemini', model: 'test-model' };
        const saved = await request('PUT', 'reader', input, {
            'x-forwarded-proto': 'http',
            origin: 'http://cowork.example.test'
        });
        expect(saved.status).toBe(200);
        expect(await saved.json()).toEqual({
            engine: 'gemini', model: 'test-model', source: 'saved', hasApiKey: true, configured: true
        });
        const raw = db.prepare('SELECT owner, engine, model FROM cowork_ai_settings').get();
        expect(raw).toEqual({ owner: 'reader', ...input });

        expect(resolveCoWorkAiSettings('admin')).toMatchObject({ engine: null, model: '', source: 'environment' });
        expect(resolveCoWorkAiSettings('reader').apiKey).toBe('fixture-reader-gemini-key');
        writeUserKeys('reader', { googleAiStudioApiKey: 'fixture-updated-key', openaiApiKey: 'fixture-reader-openai-key' });
        expect(resolveCoWorkAiSettings('reader').apiKey).toBe('fixture-updated-key');
        expect((await request('PUT', 'reader', { engine: 'gemini', model: 'test-model', apiKey: 'fixture-extra' })).status).toBe(400);
        expect((await request('PUT', 'admin', { engine: 'gemini', model: 'admin-model' })).status).toBe(200);
        expect((await request('PUT', 'reader', { engine: 'openai', model: 'next-model' })).status).toBe(200);
        expect(resolveCoWorkAiSettings('admin')).toMatchObject({ model: 'admin-model', apiKey: 'fixture-admin-gemini-key' });
        expect(resolveCoWorkAiSettings('reader').apiKey).toBe('fixture-reader-openai-key');
    });

    it('設定変更_未認証や異なるオリジン・スコープを拒否する', async () => {
        const input = { engine: 'lmstudio', model: 'test-model' };
        expect((await request('PUT', undefined, input)).status).toBe(401);
        expect((await request('PUT', 'reader', { ...input, owner: 'admin' })).status).toBe(400);
        expect((await request('PUT', 'admin', input, { origin: 'https://other.example.test' })).status).toBe(403);
        expect((await request('PUT', 'admin', input, { 'x-cowork-scope': getCoWorkScope('other') })).status).toBe(409);
        expect((await request('PUT', 'admin', input, { 'x-cowork-scope': '' })).status).toBe(403);
        expect(resolveCoWorkAiSettings('admin').source).toBe('environment');
    });

    it('設定変更_カスタムモデルにはサーバーの共有キーを使用しない', async () => {
        vi.stubEnv('COWORK_AI_ENGINE', 'gemini');
        vi.stubEnv('COWORK_AI_MODEL', 'default-model');
        vi.stubEnv('COWORK_AI_API_KEY', 'fixture-environment-key');
        const saved = await request('PUT', 'reader', { engine: 'gemini', model: 'custom-model' });
        expect(saved.status).toBe(200);
        expect(await saved.json()).toMatchObject({ hasApiKey: false, configured: false });
        expect(resolveCoWorkAiSettings('reader').apiKey).toBe('');
        expect(resolveCoWorkAiSettings('admin').apiKey).toBe('fixture-environment-key');
    });

    it('設定削除_サーバー既定値に戻し他アカウントの設定を維持する', async () => {
        vi.stubEnv('COWORK_AI_ENGINE', 'gemini');
        vi.stubEnv('COWORK_AI_MODEL', 'default-model');
        vi.stubEnv('COWORK_AI_API_KEY', 'fixture-environment-key');
        db.prepare('INSERT INTO global_configs (key, value) VALUES (?, ?)').run(
            'cowork_ai_settings', JSON.stringify({ engine: 'gemini', model: 'legacy-model' })
        );
        expect((await request('PUT', 'reader', { engine: 'lmstudio', model: 'local-model' })).status).toBe(200);
        expect((await request('PUT', 'admin', { engine: 'lmstudio', model: 'admin-model' })).status).toBe(200);
        expect(resolveCoWorkAiSettings('reader')).toMatchObject({ engine: 'lmstudio', apiKey: '' });

        const reset = await request('DELETE', 'reader');
        expect(reset.status).toBe(200);
        expect(await reset.json()).toMatchObject({ model: 'legacy-model', configured: true, source: 'server' });
        expect(resolveCoWorkAiSettings('admin')).toMatchObject({ model: 'admin-model', source: 'saved' });
    });

    it('モデル取得_OpenAIの候補とメイン設定値を所有者のキーで取得する', async () => {
        writeUserKeys('reader', { openaiApiKey: 'fixture-reader-key', openaiModel: 'gpt-example' });
        vi.stubEnv('COWORK_AI_ENGINE', 'openai');
        vi.stubEnv('COWORK_AI_API_KEY', 'fixture-environment-key');
        const fetchMock = vi.fn(async (_url: unknown, _options: RequestInit) => new Response(JSON.stringify({
            data: [{ id: 'gpt-example' }, { id: 'gpt-image-example' }, { id: 'text-embedding-example' }]
        })));
        vi.stubGlobal('fetch', fetchMock);

        expect((await request('POST', undefined, { engine: 'openai' }, undefined, modelsPath)).status).toBe(401);
        const missing = await request('POST', 'admin', { engine: 'openai' }, undefined, modelsPath);
        expect(await missing.json()).toEqual({ models: [], preferredModel: '', status: 'missing-key' });
        expect(fetchMock).not.toHaveBeenCalled();
        const available = await request('POST', 'reader', { engine: 'openai' }, undefined, modelsPath);
        expect(await available.json()).toEqual({ models: ['gpt-example'], preferredModel: 'gpt-example', status: 'ready' });
        const [url, options] = fetchMock.mock.calls[0]!;
        expect(url).toBe('https://api.openai.com/v1/models');
        expect(new Headers(options.headers).get('authorization')).toBe('Bearer fixture-reader-key');
        expect((await request('POST', 'reader', { engine: 'lmstudio', endpoint: 'http://example.test' }, undefined, modelsPath)).status).toBe(400);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('generate_実行IDを照合しタスク所有者のキーだけでGeminiを呼び出す', async () => {
        vi.stubEnv('COWORK_AI_ENGINE', 'gemini');
        vi.stubEnv('COWORK_AI_MODEL', 'test-model');
        vi.stubEnv('COWORK_AI_API_KEY', 'fixture-environment-key');
        writeUserKeys('admin', { googleAiStudioApiKey: 'fixture-admin-key' });
        writeUserKeys('reader', { googleAiStudioApiKey: 'fixture-reader-key' });
        expect((await request('PUT', 'reader', { engine: 'gemini', model: 'reader-model' })).status).toBe(200);
        const fetchMock = vi.fn(async (_url: unknown, _options: RequestInit) => new Response(JSON.stringify({
            candidates: [{ content: { role: 'model', parts: [{ text: '実行結果' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 }
        }), { headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        const agent = createCoWorkAgent(new AbortController().signal, {
            activeRunLease: () => ({ owner: 'reader', id: 'run-reader', lease_until: new Date(Date.now() + 90_000).toISOString() })
        });
        const stale = prepareCoWorkAgentInput('別の実行', 'run-admin');
        await expect(agent.generate(stale.prompt, { providerOptions: stale.providerOptions })).rejects.toThrow('CoWork の実行を確認');
        expect(fetchMock).not.toHaveBeenCalled();

        const current = prepareCoWorkAgentInput('確認', 'run-reader');
        const result = await agent.generate(current.prompt, { providerOptions: current.providerOptions });
        expect(result.text).toBe('実行結果');
        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, options] = fetchMock.mock.calls[0]!;
        expect(String(url)).toContain('/models/reader-model:');
        expect(new Headers(options.headers).get('x-goog-api-key')).toBe('fixture-reader-key');
        expect(options.body).not.toContain('run-reader');
    });
});
