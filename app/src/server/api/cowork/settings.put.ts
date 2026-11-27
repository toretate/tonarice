import { createError, defineEventHandler } from 'h3';
import { getCoWorkAiSettings, saveCoWorkAiSettings } from '../../cowork/ai-settings';
import { readCoWorkBody, requireCoWorkUser } from '../../cowork/http';
import { coWorkAiSettingsSchema, requireCoWorkSettingsWrite } from '../../cowork/settings-http';

export default defineEventHandler(async event => {
    const owner = requireCoWorkUser(event);
    requireCoWorkSettingsWrite(event);
    const input = await readCoWorkBody(event, coWorkAiSettingsSchema, 4 * 1024, 'AI サービスとモデル ID の入力内容を確認してください。');
    try {
        saveCoWorkAiSettings(owner, input);
        return getCoWorkAiSettings(owner);
    } catch {
        console.error('[CoWork] AI 設定を保存できませんでした。');
        throw createError({ statusCode: 500 });
    }
});
