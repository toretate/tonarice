export type ToolStatus = 'started' | 'succeeded' | 'failed';
export type ToolStatusCallback = (name: string, status: ToolStatus) => void;

/** 詳細ログは明示的に有効な場合だけ出力する。 */
function logDetail(name: string, type: 'query' | 'result', value: unknown): void {
    if (process.env.MASTRA_TOOL_DEBUG_CONTENT !== 'true') return;
    try {
        const serialized = JSON.stringify(value, (key, item) => {
            if (/api.?key|authorization|token|password|secret/i.test(key)) return '[マスク済み]';
            return item;
        });
        const limited = (serialized ?? 'null').slice(0, 4000);
        console.info(`[MastraTool] ${name} ${type}: ${limited}`);
    } catch {
        console.warn(`[MastraTool] ${name} ${type}のログ出力に失敗`);
    }
}

/** 実行状態だけを通知し、入力・検索語・結果などは送信しない。 */
export async function observeTool<T>(
    requestContext: { get: (key: 'onToolStatus') => unknown },
    name: string,
    execute: () => Promise<T>,
    failed: (result: T) => boolean,
    input?: unknown
): Promise<T> {
    const callback = requestContext.get('onToolStatus');
    const notify = (status: ToolStatus) => {
        try {
            if (typeof callback === 'function') callback(name, status);
        } catch {
            console.warn('[MastraTool] 実行状態の通知に失敗');
        }
    };
    notify('started');
    logDetail(name, 'query', input);
    try {
        const result = await execute();
        logDetail(name, 'result', result);
        notify(failed(result) ? 'failed' : 'succeeded');
        return result;
    } catch (error) {
        notify('failed');
        throw error;
    }
}
