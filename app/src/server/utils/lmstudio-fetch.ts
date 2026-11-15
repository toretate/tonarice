/**
 * LM Studio固有の生成設定をChat Completionsのリクエスト本文へ反映する。
 */
export function createLmStudioFetch(repetitionPenalty?: number, enableThinking?: boolean): typeof fetch {
    return async (input, init) => {
        if (!init?.body || typeof init.body !== 'string') {
            return fetch(input, init);
        }

        try {
            const body = JSON.parse(init.body) as Record<string, unknown>;
            if (repetitionPenalty !== undefined) {
                body.repetition_penalty = repetitionPenalty;
            }
            if (enableThinking === false) {
                body.reasoning_format = 'none';
                body.include_reasoning = false;
            }
            return fetch(input, { ...init, body: JSON.stringify(body) });
        } catch {
            // JSON以外の要求は加工せず、そのまま送信する。
            return fetch(input, init);
        }
    };
}

/**
 * 設定画面で指定されたエンドポイントをOpenAI互換APIの基点へそろえる。
 */
export function normalizeLmStudioBaseUrl(endpoint?: string): string {
    const baseEndpoint = endpoint?.trim() || 'http://localhost:1234/v1';
    if (baseEndpoint.endsWith('/v1') || baseEndpoint.endsWith('/v1/')) {
        return baseEndpoint.replace(/\/$/, '');
    }
    return `${baseEndpoint.replace(/\/$/, '')}/v1`;
}
