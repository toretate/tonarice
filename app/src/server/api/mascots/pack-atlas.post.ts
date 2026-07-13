import { defineEventHandler, readBody, createError, isError } from 'h3';
import { packTextureAtlas } from '../../utils/expression-edit-service';
import { isValidMascotAssetId } from '../../../utils/mascot-noface';

export default defineEventHandler(async (event) => {
    try {
        const body = await readBody(event);
        const { mascotId, outfitId, partsList } = body as {
            mascotId?: string;
            outfitId?: string;
            partsList?: Array<{ name: string; path: string; offsetX: number; offsetY: number }>;
        };

        if (!mascotId || !outfitId || !partsList || !Array.isArray(partsList)) {
            throw createError({
                statusCode: 400,
                statusMessage: 'mascotId, outfitId, and partsList (array) are required'
            });
        }
        if (!isValidMascotAssetId(mascotId) || !isValidMascotAssetId(outfitId)) {
            throw createError({ statusCode: 400, statusMessage: 'Invalid mascotId or outfitId' });
        }

        console.log(`[Server] Packing texture atlas for ${mascotId} with ${partsList.length} parts`);
        const userId = event.context?.user?.id || 'usr_local_dev_bypass';
        const result = await packTextureAtlas(userId, mascotId, outfitId, partsList);

        if (!result.success) {
            throw new Error(result.error || 'Unknown error during packing');
        }

        return {
            success: true,
            atlasPath: result.atlasPath,
            jsonPath: result.jsonPath,
            width: result.width,
            height: result.height
        };
    } catch (error: any) {
        console.error('[Server] pack-atlas failed:', error.message);
        if (isError(error)) throw error;
        throw createError({
            statusCode: 500,
            statusMessage: error.message
        });
    }
});
