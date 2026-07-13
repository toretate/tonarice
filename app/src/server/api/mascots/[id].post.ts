import { defineEventHandler, readBody, createError } from 'h3';
import fs from 'fs';
import path from 'path';
import { USERS_DIR } from '../../utils/paths';
import { safeWriteFileSync } from '../../utils/fs-helpers';

function getMascotConfigPath(userId: string, mascotId: string): string {
    return path.join(USERS_DIR, userId, 'mascots', mascotId, 'mascot_config.json');
}

function saveBase64Image(base64Data: string, userId: string, mascotId: string, assetType: string, assetId: string): string {
    const matches = base64Data.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        return base64Data;
    }

    let ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    if (ext === 'svg+xml') {
        ext = 'svg';
    }
    const dataBuffer = Buffer.from(matches[2], 'base64');

    const targetDir = path.join(USERS_DIR, userId, 'mascots', mascotId, assetType);
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const filename = `${assetId}.${ext}`;
    const filePath = path.join(targetDir, filename);

    fs.writeFileSync(filePath, dataBuffer);
    console.log(`[Server] Saved asset to ${filePath}`);

    return `/mascots/users/${userId}/${mascotId}/${assetType}/${filename}`;
}

function processMascotAssets(userId: string, mascot: any): any {
    const mascotId = mascot.id;
    if (!mascotId) return mascot;

    // avatar
    if (mascot.avatar && mascot.avatar.startsWith('data:image/')) {
        mascot.avatar = saveBase64Image(mascot.avatar, userId, mascotId, 'avatar', 'avatar');
    }

    // outfits
    if (mascot.assets && Array.isArray(mascot.assets.outfits)) {
        for (const outfit of mascot.assets.outfits) {
            if (outfit.path && outfit.path.startsWith('data:image/')) {
                outfit.path = saveBase64Image(outfit.path, userId, mascotId, 'outfits', outfit.id);
            }
        }
    }

    // expressions
    if (mascot.assets && Array.isArray(mascot.assets.expressions)) {
        for (const expr of mascot.assets.expressions) {
            if (expr.path && expr.path.startsWith('data:image/')) {
                expr.path = saveBase64Image(expr.path, userId, mascotId, 'expressions', expr.id);
            }
        }
    }

    // poses
    if (mascot.assets && Array.isArray(mascot.assets.poses)) {
        for (const pose of mascot.assets.poses) {
            if (pose.path && pose.path.startsWith('data:image/')) {
                pose.path = saveBase64Image(pose.path, userId, mascotId, 'poses', pose.id);
            }
        }
    }

    return mascot;
}

export default defineEventHandler(async (event) => {
    try {
        const mascotId = event.context.params?.id;
        console.log(`[Server] Save mascot request received for: ${mascotId}`);
        
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
        let mascot = await readBody(event);
        
        if (mascot.id !== mascotId) {
            mascot.id = mascotId;
        }

        // アセット処理（Base64画像のデコード保存）
        mascot = processMascotAssets(userId, mascot);

        // 個別JSONファイルへの保存
        const configPath = getMascotConfigPath(userId, mascotId);
        const mascotDir = path.dirname(configPath);
        if (!fs.existsSync(mascotDir)) {
            fs.mkdirSync(mascotDir, { recursive: true });
        }

        safeWriteFileSync(configPath, JSON.stringify(mascot, null, 4));
        console.log(`[Server] Mascot saved successfully: ${configPath}`);

        return { success: true, mascot };
    } catch (error: any) {
        console.error('[Server] Failed to save mascot:', error.message);
        throw createError({
            statusCode: 500,
            statusMessage: error.message
        });
    }
});
