import { createHash } from 'node:crypto';
import { createError, getHeader, getRequestURL, getRequestWebStream, setHeader, type H3Event } from 'h3';
import type { ZodType } from 'zod';

export function requireCoWorkUser(event: H3Event) {
    setHeader(event, 'Cache-Control', 'no-store');
    const userId = event.context.user?.id;
    if (typeof userId !== 'string' || !userId) throw createError({ statusCode: 401 });
    const scope = getCoWorkScope(userId);
    const expectedScope = getHeader(event, 'x-cowork-scope');
    if (expectedScope && expectedScope !== scope) {
        throw createError({ statusCode: 409, message: 'ログイン先が変わりました。CoWork を更新してください。' });
    }
    return userId;
}

export function getCoWorkScope(userId: string) {
    return createHash('sha256').update(JSON.stringify(['cowork', userId])).digest('hex');
}

export function requireSecurePairing(event: H3Event) {
    const url = getRequestURL(event);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        throw createError({ statusCode: 403, message: 'デスクトップ版との接続には HTTPS が必要です。' });
    }
}

export function requireJson(event: H3Event) {
    if (getHeader(event, 'content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        throw createError({ statusCode: 415 });
    }
}

export async function readCoWorkBody<T>(event: H3Event, schema: ZodType<T>, limit = 128 * 1024): Promise<T> {
    requireJson(event);
    const tooLarge = () => createError({ statusCode: 413, message: 'データのサイズが上限を超えています。' });
    if (Number(getHeader(event, 'content-length')) > limit) throw tooLarge();
    const reader = getRequestWebStream(event)?.getReader();
    if (!reader) throw createError({ statusCode: 400, message: '入力データがありません。' });

    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) {
                void reader.cancel().catch(() => {});
                throw tooLarge();
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    let raw: unknown;
    try {
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
        throw createError({ statusCode: 400, message: 'JSON の形式が正しくありません。' });
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw createError({ statusCode: 400, message: '定期実行データの入力内容を確認してください。' });
    return parsed.data;
}

export function requireTask<T>(result: T | undefined | false): T {
    if (!result) throw createError({ statusCode: 404, message: '定期実行タスクが見つかりません。' });
    return result;
}
