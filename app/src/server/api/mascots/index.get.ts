import { defineEventHandler, createError } from 'h3';
import fs from 'fs';
import path from 'path';
import { USERS_DIR } from '../../utils/paths';

function getUserMascotsDir(userId: string): string {
    return path.join(USERS_DIR, userId, 'mascots');
}

export default defineEventHandler(async (event) => {
    try {
        console.log('[Server] Get mascots list request received');
        if (!event.context.user) {
            throw createError({
                statusCode: 401,
                statusMessage: '認証情報が見つかりません。'
            });
        }

        const userId = event.context.user.id;
        const mascotsDir = getUserMascotsDir(userId);
        const mascots: any[] = [];

        if (fs.existsSync(mascotsDir)) {
            const dirs = fs.readdirSync(mascotsDir, { withFileTypes: true });
            for (const d of dirs) {
                if (d.isDirectory()) {
                    const mascotId = d.name;
                    const configPath = path.join(mascotsDir, mascotId, 'mascot_config.json');
                    if (fs.existsSync(configPath)) {
                        try {
                            const configData = fs.readFileSync(configPath, 'utf8');
                            mascots.push(JSON.parse(configData));
                        } catch (e: any) {
                            console.error(`[Server] Failed to load mascot config for ${mascotId}:`, e.message);
                        }
                    }
                }
            }
        }

        return { success: true, mascots };
    } catch (error: any) {
        console.error('[Server] Failed to load mascots:', error.message);
        throw createError({
            statusCode: 500,
            statusMessage: error.message
        });
    }
});
