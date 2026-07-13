import { defineEventHandler, readBody, createError, isError } from 'h3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveMascotPath } from '../../utils/paths';

export default defineEventHandler(async (event) => {
    try {
        const body = await readBody(event);
        const { mascotId, filename, base64Data } = body as { mascotId?: string; filename?: string; base64Data?: string };

        if (!mascotId || !filename || !base64Data) {
            throw createError({
                statusCode: 400,
                statusMessage: 'mascotId, filename and base64Data are required'
            });
        }

        // mascotId のバリデーション (英数字、アンダースコア、ハイフンのみ許可)
        if (!/^[a-zA-Z0-9_-]+$/.test(mascotId)) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Invalid mascotId'
            });
        }

        // filename のバリデーション (親ディレクトリ移動を禁止)
        if (filename.includes('..') || filename.includes('\\')) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Invalid filename'
            });
        }

        let userId = 'usr_local_dev_bypass';
        if (event.context.user) {
            userId = event.context.user.id;
        }

        // 保存先パスを解決
        const requestPath = `/mascots/users/${userId}/${mascotId}/${filename}`;
        const absPath = resolveMascotPath(requestPath);

        // ディレクトリトラバーサル防止チェック
        const baseDir = resolveMascotPath(`/mascots/users/${userId}/${mascotId}`);
        const relativePath = path.relative(baseDir, absPath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Directory traversal detected'
            });
        }

        // ディレクトリ作成
        fs.mkdirSync(path.dirname(absPath), { recursive: true });

        // Base64デコードとファイル保存
        const cleanBase64 = base64Data.replace(/^data:image\/[\w+.-]+;base64,/, "");
        const buffer = Buffer.from(cleanBase64, 'base64');

        fs.writeFileSync(absPath, buffer);

        console.log(`[Server] Saved mascot image: ${absPath}`);
        return { success: true, path: `${requestPath}?v=${randomUUID()}` };
    } catch (error: any) {
        console.error('[Server] save-image failed:', error.message);
        if (isError(error)) {
            throw error;
        }
        throw createError({
            statusCode: 500,
            statusMessage: error.message
        });
    }
});
