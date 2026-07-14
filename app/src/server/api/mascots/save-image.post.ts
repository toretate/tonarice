import { defineEventHandler, readBody, readMultipartFormData, getHeader, createError, isError } from 'h3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveMascotPath } from '../../utils/paths';

export default defineEventHandler(async (event) => {
    try {
        const contentType = getHeader(event, 'content-type') || '';
        let mascotId: string | undefined;
        let filename: string | undefined;
        let imageBuffer: Buffer | undefined;

        if (contentType.toLowerCase().startsWith('multipart/form-data')) {
            const parts = await readMultipartFormData(event);
            mascotId = parts?.find(part => part.name === 'mascotId')?.data.toString('utf8');
            filename = parts?.find(part => part.name === 'filename')?.data.toString('utf8');
            const imagePart = parts?.find(part => part.name === 'image');
            if (imagePart && !imagePart.type?.startsWith('image/')) {
                throw createError({ statusCode: 400, statusMessage: 'image must be an image file' });
            }
            imageBuffer = imagePart?.data;
        } else {
            const body = await readBody(event);
            const base64Data = (body as { base64Data?: string })?.base64Data;
            mascotId = (body as { mascotId?: string })?.mascotId;
            filename = (body as { filename?: string })?.filename;
            if (base64Data) {
                const cleanBase64 = base64Data.replace(/^data:image\/[\w+.-]+;base64,/, '');
                imageBuffer = Buffer.from(cleanBase64, 'base64');
            }
        }

        if (!mascotId || !filename || !imageBuffer?.length) {
            throw createError({
                statusCode: 400,
                statusMessage: 'mascotId, filename and image are required'
            });
        }

        if (imageBuffer.length > 25 * 1024 * 1024) {
            throw createError({ statusCode: 413, statusMessage: 'Image size exceeds 25 MB' });
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

        fs.writeFileSync(absPath, imageBuffer);

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
