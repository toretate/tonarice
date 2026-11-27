import { readFileSync } from 'node:fs';
import { coworkAiEngines, type CoWorkAiEngine, type CoWorkAiSettings, type CoWorkAiSettingsInput } from '../../types/cowork-ai-settings';
import { getDB } from '../utils/db';
import { getUserConfigPath } from '../utils/user-config-path';

const legacyServerKey = 'cowork_ai_settings';
const initialized = new WeakSet<ReturnType<typeof getDB>>();

function getSettingsDb() {
    const db = getDB();
    if (!initialized.has(db)) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS cowork_ai_settings (
                owner TEXT PRIMARY KEY,
                engine TEXT NOT NULL,
                model TEXT NOT NULL
            )
        `);
        initialized.add(db);
    }
    return db;
}

function environmentSettings() {
    const engine = process.env.COWORK_AI_ENGINE?.trim();
    return {
        engine: coworkAiEngines.find(item => item === engine) ?? null,
        model: process.env.COWORK_AI_MODEL?.trim() ?? '',
        apiKey: process.env.COWORK_AI_API_KEY?.trim() ?? ''
    };
}

function readAccountSettings(owner: string) {
    return getSettingsDb().prepare<[string], CoWorkAiSettingsInput>(
        'SELECT engine, model FROM cowork_ai_settings WHERE owner = ?'
    ).get(owner);
}

function readServerSettings(): CoWorkAiSettingsInput | undefined {
    // 旧設定画面で保存されたサーバー共通設定は、アカウント設定がない場合に引き継ぐ。
    const row = getDB().prepare<[string], { value: string }>(
        'SELECT value FROM global_configs WHERE key = ?'
    ).get(legacyServerKey);
    return row ? JSON.parse(row.value) as CoWorkAiSettingsInput : undefined;
}

export function readCoWorkMainAiSettings(owner: string, engine: CoWorkAiEngine | null) {
    const empty = { apiKey: '', model: '' };
    if (!engine) return empty;
    try {
        const config = JSON.parse(readFileSync(getUserConfigPath(owner), 'utf8'));
        const key = engine === 'gemini' ? config?.googleAiStudioApiKey : engine === 'openai' ? config?.openaiApiKey : '';
        const model = engine === 'gemini' ? config?.geminiModel : engine === 'openai' ? config?.openaiModel : config?.lmstudioModel;
        return {
            apiKey: typeof key === 'string' ? key.trim() : '',
            model: typeof model === 'string' ? model.trim().slice(0, 256) : ''
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn('[CoWork] アカウントの API キー設定を読み込めませんでした。');
        }
    }
    return empty;
}

export function getCoWorkLmStudioEndpoint() {
    return process.env.COWORK_LMSTUDIO_ENDPOINT?.trim() || 'http://127.0.0.1:1234/v1';
}

export function resolveCoWorkAiSettings(owner: string) {
    const saved = readAccountSettings(owner);
    const server = readServerSettings();
    const env = environmentSettings();
    const defaults = server ?? env;
    const { engine, model } = saved ?? defaults;
    const source: CoWorkAiSettings['source'] = saved ? 'saved' : server ? 'server' : 'environment';
    // サーバーの共有キーはサーバー既定のサービスとモデルにだけ使用する。
    const usesServerModel = engine === defaults.engine && model === defaults.model;
    const serverKey = usesServerModel && engine !== 'lmstudio' && engine === env.engine ? env.apiKey : '';
    return {
        engine,
        model,
        apiKey: readCoWorkMainAiSettings(owner, engine).apiKey || serverKey,
        lmstudioEndpoint: getCoWorkLmStudioEndpoint(),
        source
    };
}

export function getCoWorkAiSettings(owner: string): CoWorkAiSettings {
    const { engine, model, apiKey, source } = resolveCoWorkAiSettings(owner);
    return {
        engine,
        model,
        source,
        hasApiKey: Boolean(apiKey),
        configured: Boolean(engine && model && (engine === 'lmstudio' || apiKey))
    };
}

export function saveCoWorkAiSettings(owner: string, input: CoWorkAiSettingsInput) {
    getSettingsDb().prepare(`
        INSERT INTO cowork_ai_settings(owner, engine, model) VALUES (?, ?, ?)
        ON CONFLICT(owner) DO UPDATE SET engine = excluded.engine, model = excluded.model
    `).run(owner, input.engine, input.model);
}

export function resetCoWorkAiSettings(owner: string) {
    getSettingsDb().prepare('DELETE FROM cowork_ai_settings WHERE owner = ?').run(owner);
}
