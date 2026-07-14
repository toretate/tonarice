import { defineEventHandler, readBody, createError, isError } from 'h3';
import { generateNofaceImage } from '../../utils/expression-edit-service';
import { buildOutfitNofacePath, isValidMascotAssetId } from '../../../utils/mascot-noface';

export default defineEventHandler(async (event) => {
    try {
        const body = await readBody(event);
        const { mascotId, outfitId, inputPath, detectMode, engine, prompt, geminiApiKey, force } = body as {
            mascotId?: string;
            outfitId?: string;
            inputPath?: string;
            detectMode?: string;
            engine?: string;
            prompt?: string;
            geminiApiKey?: string;
            force?: boolean;
        };

        if (!mascotId || !outfitId || !inputPath) {
            throw createError({
                statusCode: 400,
                statusMessage: 'mascotId, outfitId, and inputPath are required'
            });
        }
        if (!isValidMascotAssetId(mascotId) || !isValidMascotAssetId(outfitId)) {
            throw createError({ statusCode: 400, statusMessage: 'Invalid mascotId or outfitId' });
        }

        // のっぺらぼう画像の保存先を決定
        const userId = event.context?.user?.id || 'usr_local_dev_bypass';
        const filename = buildOutfitNofacePath(mascotId, outfitId, userId);

        console.log(`[Server] Generating noface image for ${mascotId} from ${inputPath} with engine=${engine || 'mediapipe'} detectMode=${detectMode || 'ai'} force=${force !== false}`);
        const resultPath = await generateNofaceImage(inputPath, filename, detectMode, engine, prompt, geminiApiKey, force !== false);

        return { success: true, path: resultPath };
    } catch (error: any) {
        console.error('[Server] generate-noface failed:', error.message);
        if (isError(error)) throw error;
        throw createError({
            statusCode: 500,
            statusMessage: error.message
        });
    }
});
