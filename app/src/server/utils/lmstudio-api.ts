const DEFAULT_LMSTUDIO_ENDPOINT = 'http://127.0.0.1:1234/v1/';

export function normalizeLmStudioEndpoint(endpoint?: string): string {
    const url = new URL(endpoint?.trim() || DEFAULT_LMSTUDIO_ENDPOINT);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('LM StudioのエンドポイントはHTTPまたはHTTPSで指定してください。');
    }

    const pathname = url.pathname.replace(/\/+$/, '');
    url.pathname = pathname.endsWith('/v1') ? `${pathname}/` : `${pathname}/v1/`;
    url.search = '';
    url.hash = '';
    return url.toString();
}

export async function fetchLmStudioModels(endpoint?: string): Promise<unknown[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(new URL('models', normalizeLmStudioEndpoint(endpoint)), {
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`LM Studio API Error: ${response.status}`);
        }

        const data = await response.json() as { data?: unknown[] };
        return data.data || [];
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.warn('[LM Studio] LM Studioとの接続がタイムアウトしました。');
        } else {
            console.warn('[LM Studio] LM Studioとの接続エラー');
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}
