import { createError, defineEventHandler, readBody } from 'h3';
import {
    MASCOT_PROMPT_NAMES,
    MAX_PROMPT_LENGTH,
    writeUserMascotPrompts,
    type MascotPromptName
} from '../../utils/mascot-prompts';

export default defineEventHandler(async event => {
    const userId = event.context.user?.id;
    if (!userId) throw createError({ statusCode: 401 });

    const body = await readBody(event);
    const mascotId = body?.mascotId;
    const rawPrompts = body?.prompts;
    if (
        typeof mascotId !== 'string'
        || !/^[a-zA-Z0-9_-]{1,200}$/.test(mascotId)
        || !rawPrompts
        || typeof rawPrompts !== 'object'
        || Array.isArray(rawPrompts)
    ) {
        throw createError({ statusCode: 400, statusMessage: '入力が不正です。' });
    }

    const prompts: Partial<Record<MascotPromptName, string>> = {};
    for (const name of MASCOT_PROMPT_NAMES) {
        const value = rawPrompts[name];
        if (value !== undefined && (typeof value !== 'string' || value.length > MAX_PROMPT_LENGTH)) {
            throw createError({ statusCode: 400, statusMessage: `${name} プロンプトが不正です。` });
        }
        prompts[name] = value ?? '';
    }

    const saved = writeUserMascotPrompts(userId, mascotId, prompts);
    if (!saved) throw createError({ statusCode: 404 });

    return { success: true, prompts: saved };
});
