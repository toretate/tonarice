import fs from 'node:fs';
import path from 'node:path';
import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3';
import { OpenAiImageConnector } from '../../../connector/openai-image-connector';
import { USERS_DIR } from '../../utils/paths';

export default defineEventHandler(async (event) => {
    try {
        const body = await readBody(event);
        if (!body?.params) {
            throw createError({ statusCode: 400, statusMessage: 'params is required' });
        }

        const userId = event.context.user?.id || 'usr_local_dev_bypass';
        const configPath = path.join(USERS_DIR, userId, 'user_config.json');
        const userConfig = fs.existsSync(configPath)
            ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
            : {};
        const image = await OpenAiImageConnector.generateImage(body.params, userConfig.openaiApiKey || '');
        return { success: true, image };
    } catch (error: any) {
        const message = error.message || error.statusMessage || '不明なエラー';
        console.error(`[Server] OpenAIとの接続エラー: ${message}`);
        setResponseStatus(event, error.statusCode || 502);
        return { success: false, error: message };
    }
});
