import { createError, defineEventHandler, getRequestHeader, readBody } from 'h3';
import { reloadLmStudioModel, LmStudioManagementError } from '../../utils/lmstudio-model-management';

function parseUrl(value: string): URL | undefined {
    try { return new URL(value); }
    catch { return undefined; }
}

export default defineEventHandler(async (event) => {
    // Nitro内で接続元IPを取得できない場合があるため、ローカルHostと同一オリジンで判定する。
    if (!getRequestHeader(event, 'content-type')?.toLowerCase().startsWith('application/json')) {
        throw createError({ statusCode: 415, message: 'JSON形式の要求が必要です。' });
    }
    const origin = getRequestHeader(event, 'origin');
    const host = getRequestHeader(event, 'host');
    const hostName = host ? parseUrl(`http://${host}`)?.hostname || '' : '';
    if (!['localhost', '127.0.0.1', '[::1]'].includes(hostName)) {
        throw createError({ statusCode: 403, message: 'モデルの再ロードはlocalhostで開いた設定画面からのみ実行できます。' });
    }
    if (origin && (!host || parseUrl(origin)?.host !== host)) {
        throw createError({ statusCode: 403, message: '別のサイトからモデルを再ロードできません。' });
    }
    const body = await readBody<{ endpoint?: string; modelKey?: string; contextLength?: number }>(event);
    try {
        return await reloadLmStudioModel(body?.endpoint, body?.modelKey || '', body?.contextLength as number);
    } catch (error) {
        const statusCode = error instanceof LmStudioManagementError ? error.statusCode : 400;
        const message = error instanceof Error ? error.message : 'モデルの再ロードに失敗しました。';
        throw createError({ statusCode, message });
    }
});
