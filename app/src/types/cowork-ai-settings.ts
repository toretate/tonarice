export const coworkAiEngines = ['gemini', 'openai', 'lmstudio'] as const;
export type CoWorkAiEngine = typeof coworkAiEngines[number];

export interface CoWorkAiSettings {
    engine: CoWorkAiEngine | null;
    model: string;
    source: 'saved' | 'server' | 'environment';
    hasApiKey: boolean;
    configured: boolean;
}

export interface CoWorkAiSettingsInput {
    engine: CoWorkAiEngine;
    model: string;
}

export interface CoWorkModelCatalog {
    models: string[];
    preferredModel: string;
    status: 'ready' | 'missing-key' | 'unavailable';
}
