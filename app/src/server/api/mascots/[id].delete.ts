import { defineEventHandler, createError } from 'h3';
import fs from 'fs';
import path from 'path';
import { USERS_DIR } from '../../utils/paths';

function getMascotDir(userId: string, mascotId: string): string {
    return path.join(USERS_DIR, userId, 'mascots', mascotId);
}

export default defineEventHandler(async (event) => {
    try {
        const mascotId = event.context.params?.id;
        console.log(`[Server] Delete mascot request received for: ${mascotId}`);
        
        if (!event.context.user) {
            throw createError({
                statusCode: 401,
                statusMessage: '認証情報が見つかりません。'
            });
        }

        if (!mascotId) {
            throw createError({
                statusCode: 400,
                statusMessage: 'マスコットIDが指定されていません。'
            });
        }

        const userId = event.context.user.id;
        const mascotDir = getMascotDir(userId, mascotId);

        if (fs.existsSync(mascotDir)) {
            fs.rmSync(mascotDir, { recursive: true, force: true });
            console.log(`[Server] Deleted mascot directory: ${mascotDir}`);
        } else {
            console.warn(`[Server] Mascot directory does not exist: ${mascotDir}`);
        }

        return { success: true };
    } catch (error: any) {
        console.error('[Server] Failed to delete mascot:', error.message);
        throw createError({
            statusCode: 500,
            statusMessage: error.message
        });
    }
});
