import { createError, defineEventHandler, readBody } from 'h3';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { USERS_DIR } from '../../utils/paths';
import { safeWriteFileSync } from '../../utils/fs-helpers';
import { applyMascotCliSettings, saveMascotCliSettings } from '../../utils/mascot-cli-settings';

export default defineEventHandler(async event => {
    const userId = event.context.user?.id;
    if (!userId) throw createError({ statusCode: 401 });
    const body = await readBody(event);
    if (!body || !['create', 'profile', 'model'].includes(body.action)) throw createError({ statusCode: 400 });
    const creating = body.action === 'create';
    const id = creating ? `mascot_${randomUUID()}` : body.id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw createError({ statusCode: 400 });
    const dir = path.join(USERS_DIR, userId, 'mascots', id);
    const file = path.join(dir, 'mascot_config.json');
    let mascot;
    if (creating) {
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) throw createError({ statusCode: 400 });
        mascot = { id, name: body.name.trim(), avatar: '🤖', profile: '', aiConfig: { chat: { engine: 'lmstudio', model: '', temperature: 0.7 }, voice: { engine: 'voicevox', speaker_id: 2, style: 'normal' } }, assets: { outfits: [], expressions: [], poses: [] } };
    } else {
        if (!fs.existsSync(file)) throw createError({ statusCode: 404 });
        mascot = applyMascotCliSettings(dir, JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    if (body.action === 'profile') {
        if (typeof body.profile !== 'string' || body.profile.length > 20000) throw createError({ statusCode: 400 });
        mascot.profile = body.profile;
    }
    if (body.action === 'model') {
        if (!['lmstudio', 'openai', 'gemini'].includes(body.engine) || typeof body.model !== 'string' || !body.model.trim() || body.model.length > 500) throw createError({ statusCode: 400 });
        mascot.aiConfig = { ...mascot.aiConfig, chat: { ...mascot.aiConfig?.chat, engine: body.engine, model: body.model.trim() } };
    }
    safeWriteFileSync(file, JSON.stringify(mascot, null, 4));
    saveMascotCliSettings(dir, mascot);
    return { success: true, mascot };
});
