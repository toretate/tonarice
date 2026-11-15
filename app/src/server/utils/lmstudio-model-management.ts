import { normalizeLmStudioEndpoint } from './lmstudio-api';

interface LoadedInstance {
    id: string;
    config?: {
        context_length?: number;
        eval_batch_size?: number;
        flash_attention?: boolean;
        num_experts?: number;
        offload_kv_cache_to_gpu?: boolean;
    };
}

interface NativeModel {
    key: string;
    type: string;
    max_context_length?: number;
    loaded_instances?: LoadedInstance[];
}

export class LmStudioManagementError extends Error {
    constructor(message: string, public readonly statusCode: number) {
        super(message);
    }
}

function nativeUrl(endpoint: string | undefined, path: string): URL {
    const openAiUrl = new URL(normalizeLmStudioEndpoint(endpoint));
    const prefix = openAiUrl.pathname.replace(/v1\/$/, '');
    openAiUrl.pathname = `${prefix}api/v1/${path}`;
    return openAiUrl;
}

async function requestNative(endpoint: string | undefined, path: string, body?: object): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), body ? 120000 : 10000);
    try {
        const response = await fetch(nativeUrl(endpoint, path), {
            method: body ? 'POST' : 'GET',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal
        });
        if (!response.ok) {
            throw new LmStudioManagementError(`LM Studioの管理APIがエラーを返しました (${response.status})。`, 502);
        }
        return await response.json();
    } catch (error) {
        if (error instanceof LmStudioManagementError) throw error;
        console.warn('[LM Studio] モデル管理APIとの接続エラー');
        throw new LmStudioManagementError('LM Studioの管理APIに接続できませんでした。', 502);
    } finally {
        clearTimeout(timeoutId);
    }
}

async function findModel(endpoint: string | undefined, modelKey: string): Promise<NativeModel> {
    if (!modelKey?.trim()) {
        throw new LmStudioManagementError('モデルを選択してください。', 400);
    }
    const payload = await requestNative(endpoint, 'models') as { models?: NativeModel[] };
    const model = payload.models?.find(item => item.key === modelKey && item.type === 'llm');
    if (!model) {
        throw new LmStudioManagementError('選択したモデルがLM Studioに見つかりません。', 404);
    }
    return model;
}

export async function getLmStudioModelStatus(endpoint: string | undefined, modelKey: string) {
    const model = await findModel(endpoint, modelKey);
    const instances = model.loaded_instances || [];
    return {
        modelKey: model.key,
        maxContextLength: model.max_context_length || null,
        loadedInstances: instances.map(instance => ({
            id: instance.id,
            contextLength: instance.config?.context_length || null
        }))
    };
}

export async function reloadLmStudioModel(endpoint: string | undefined, modelKey: string, contextLength: number) {
    if (!Number.isSafeInteger(contextLength) || contextLength < 1024) {
        throw new LmStudioManagementError('コンテキストサイズは1024以上の整数で指定してください。', 400);
    }
    const model = await findModel(endpoint, modelKey);
    if (model.max_context_length && contextLength > model.max_context_length) {
        throw new LmStudioManagementError(`このモデルの最大コンテキストサイズは${model.max_context_length}です。`, 400);
    }
    const instances = model.loaded_instances || [];
    if (instances.length > 1) {
        throw new LmStudioManagementError('このモデルは複数インスタンスがロードされています。LM Studioで一つにしてから再試行してください。', 409);
    }
    const previous = instances[0];
    if (previous?.config?.context_length === contextLength) {
        return { modelKey, contextLength, unchanged: true };
    }

    const previousOptions = previous?.config ? {
        eval_batch_size: previous.config.eval_batch_size,
        flash_attention: previous.config.flash_attention,
        num_experts: previous.config.num_experts,
        offload_kv_cache_to_gpu: previous.config.offload_kv_cache_to_gpu
    } : {};

    console.info('[LM Studio] モデルの指定サイズでの再ロードを開始');
    if (previous) {
        await requestNative(endpoint, 'models/unload', { instance_id: previous.id });
    }
    try {
        await requestNative(endpoint, 'models/load', { model: modelKey, context_length: contextLength, ...previousOptions });
    } catch (error) {
        if (previous?.config?.context_length) {
            try {
                await requestNative(endpoint, 'models/load', { model: modelKey, context_length: previous.config.context_length, ...previousOptions });
                console.warn('[LM Studio] 再ロード失敗のため以前のサイズに復旧しました');
            } catch {
                console.warn('[LM Studio] 以前のサイズへの復旧にも失敗しました');
                throw new LmStudioManagementError('再ロードと以前のサイズへの復旧に失敗しました。LM Studioでモデルを確認してください。', 502);
            }
        }
        throw error;
    }
    console.info('[LM Studio] モデルの指定サイズでの再ロードが完了');
    return { modelKey, contextLength, unchanged: false };
}
