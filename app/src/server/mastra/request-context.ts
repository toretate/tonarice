import { RequestContext } from '@mastra/core/request-context';

export interface MascotAgentRequestContextValues {
    resolvedModel: unknown;
    engine: string;
    modelId: string;
}

export interface CreateMascotRequestContextParams {
    resolvedModel: unknown;
    engine: string;
    modelId: string;
}

/**
 * Agent実行用のRequest Contextを生成する。
 * APIキーはモデル内部に閉じ込め、Contextへ直接格納しない。
 */
export function createMascotRequestContext(
    params: CreateMascotRequestContextParams
): RequestContext<MascotAgentRequestContextValues> {
    return new RequestContext<MascotAgentRequestContextValues>([
        ['resolvedModel', params.resolvedModel],
        ['engine', params.engine],
        ['modelId', params.modelId]
    ]);
}
