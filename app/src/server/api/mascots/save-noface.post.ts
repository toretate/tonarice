import { defineEventHandler, readBody, createError, isError } from 'h3';
import fs from 'node:fs';
import path from 'node:path';
import { resolveMascotPath } from '../../utils/paths';
import { buildOutfitNofacePath, isValidMascotAssetId } from '../../../utils/mascot-noface';
import { normalizeNofaceImage } from '../../utils/expression-edit-service';

export default defineEventHandler(async (event) => {
    try {
        const body = await readBody(event);
        const { mascotId, outfitId, sourcePath, imageBase64 } = body as { mascotId?: string; outfitId?: string; sourcePath?: string; imageBase64?: string };

        if (!mascotId || !outfitId || !sourcePath || !imageBase64) {
            throw createError({
                statusCode: 400,
                statusMessage: 'mascotId, outfitId, sourcePath, and imageBase64 are required'
            });
        }
        if (!isValidMascotAssetId(mascotId) || !isValidMascotAssetId(outfitId)) {
            throw createError({ statusCode: 400, statusMessage: 'Invalid mascotId or outfitId' });
        }

        // noface.png の保存先ファイルパスを解決
        const userId = event.context?.user?.id || 'usr_local_dev_bypass';
        const requestPath = buildOutfitNofacePath(mascotId, outfitId, userId);
        const absPath = resolveMascotPath(requestPath);

        // ディレクトリ作成
        fs.mkdirSync(path.dirname(absPath), { recursive: true });

        // Base64デコードとファイル保存
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');

        fs.writeFileSync(absPath, buffer);
        await normalizeNofaceImage(sourcePath, requestPath);

        console.log(`[Server] Saved noface image: ${absPath}`);
        return { success: true, path: requestPath };
    } catch (error: any) {
        console.error('[Server] save-noface failed:', error.message);
        if (isError(error)) throw error;
        throw createError({
            statusCode: 500,
            statusMessage: error.message
        });
    }
});
