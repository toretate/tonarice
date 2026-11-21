/** LoRA一覧の取得を検証し、失敗時も一定の応答形式を維持する。 */
export async function fetchIrodoriLoras(endpoint?: string) {
    let url: URL;
    try {
        const base = endpoint || 'http://127.0.0.1:8088';
        url = new URL(`${base.replace(/\/$/, '')}/v1/audio/loras`);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('無効なプロトコル');
    } catch {
        return { success: false, loras: [], error: '接続先にはHTTPまたはHTTPSのURLを指定してください。' };
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    console.info('[IrodoriTTS] LoRA一覧取得を開始');
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('エラー応答');
        const data = await response.json();
        if (!Array.isArray(data?.data)) throw new Error('応答形式が不正');
        console.info(`[IrodoriTTS] LoRA一覧取得が完了 (${data.data.length}件)`);
        return { success: true, loras: data.data };
    } catch {
        console.warn('[IrodoriTTS] LoRA一覧取得との接続エラー');
        return { success: false, loras: [], error: controller.signal.aborted ? '接続がタイムアウトしました。' : 'LoRA一覧の取得に失敗しました。' };
    } finally {
        clearTimeout(timeoutId);
    }
}
