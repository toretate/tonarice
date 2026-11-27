import type { CoWorkAiEngine, CoWorkModelCatalog } from '../../types/cowork-ai-settings';
import { fetchLmStudioModels } from '../utils/lmstudio-api';
import { getCoWorkLmStudioEndpoint, readCoWorkMainAiSettings } from './ai-settings';

const modelId = (entry: unknown) => {
    if (entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string') return entry.id;
    return '';
};
const unsupportedOpenAi = /(?:^|-)(?:image|audio|realtime|live|transcribe|tts|embedding|moderation|search|translate)(?:-|$)/i;

async function listOpenAiModels(apiKey: string, signal: AbortSignal) {
    const response = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: 'error',
        signal
    });
    if (!response.ok) throw new Error('OpenAI のモデル一覧を取得できませんでした。');
    const { data } = await response.json() as { data?: unknown[] };
    return (data ?? []).map(modelId)
        .filter(id => /^(?:gpt-|chatgpt-|o[1-9](?:-|$)|ft:)/i.test(id) && !unsupportedOpenAi.test(id));
}

interface GeminiModel {
    name?: string;
    supportedGenerationMethods?: string[];
}

async function listGeminiModels(apiKey: string, signal: AbortSignal) {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    const ids: string[] = [];
    for (let page = 0; page < 5; page += 1) {
        const response = await fetch(url, { headers: { 'x-goog-api-key': apiKey }, redirect: 'error', signal });
        if (!response.ok) throw new Error('Gemini のモデル一覧を取得できませんでした。');
        const { models, nextPageToken } = await response.json() as { models?: GeminiModel[]; nextPageToken?: string };
        for (const model of models ?? []) {
            if (model.name?.startsWith('models/gemini-') && model.supportedGenerationMethods?.includes('generateContent')) {
                ids.push(model.name.slice('models/'.length));
            }
        }
        if (!nextPageToken) break;
        url.searchParams.set('pageToken', nextPageToken);
    }
    return ids;
}

export async function getCoWorkModelCatalog(owner: string, engine: CoWorkAiEngine): Promise<CoWorkModelCatalog> {
    const { apiKey, model: preferredModel } = readCoWorkMainAiSettings(owner, engine);
    if (engine !== 'lmstudio' && !apiKey) return { models: [], preferredModel, status: 'missing-key' };

    try {
        const signal = AbortSignal.timeout(8_000);
        const ids = engine === 'openai'
            ? await listOpenAiModels(apiKey, signal)
            : engine === 'gemini'
                ? await listGeminiModels(apiKey, signal)
                : (await fetchLmStudioModels(getCoWorkLmStudioEndpoint())).map(modelId);
        const models = [...new Set(ids.map(id => id.trim()).filter(id => id && id.length <= 256))].sort();
        return { models, preferredModel, status: 'ready' };
    } catch {
        console.warn('[CoWork] モデル一覧を取得できませんでした。', { engine });
        return { models: [], preferredModel, status: 'unavailable' };
    }
}
