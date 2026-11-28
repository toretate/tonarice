import { createError, defineEventHandler, readBody } from 'h3';
import { isAuthBypassAllowed } from '../../utils/auth-bypass';
import {
    MASCOT_PROMPT_NAMES,
    MascotPromptConflict,
    MAX_PROMPT_LENGTH,
    writeUserMascotMemory,
    writeUserMascotPrompts,
    type MascotPromptName
} from '../../utils/mascot-prompts';

const LOCAL_DEV_BYPASS_USER_ID = 'usr_local_dev_bypass';

export default defineEventHandler(async event => {
    const userId = event.context.user?.id;
    if (!userId) throw createError({ statusCode: 401 });

    const body = await readBody(event);
    const mascotId = body?.mascotId;
    if (typeof mascotId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(mascotId)) {
        throw createError({ statusCode: 400, statusMessage: '入力が不正です。' });
    }

    // 長期記憶だけを保存する経路（memory.md のみを更新）
    if (body?.mode === 'memory') {
        const memory = body.memory;
        const expectedCurrentMemory = body.expectedCurrentMemory;
        if (
            typeof memory !== 'string'
            || memory.length > MAX_PROMPT_LENGTH
            || (expectedCurrentMemory !== undefined && (typeof expectedCurrentMemory !== 'string' || expectedCurrentMemory.length > MAX_PROMPT_LENGTH))
        ) {
            throw createError({ statusCode: 400, statusMessage: 'memory プロンプトが不正です。' });
        }

        const allowLegacyLocalFallback = isAuthBypassAllowed() && userId === LOCAL_DEV_BYPASS_USER_ID;
        const result = writeUserMascotMemory(userId, mascotId, memory, {
            expectedCurrentMemory,
            allowLegacyLocalFallback
        });
        if (result.status === 'not_found') throw createError({ statusCode: 404 });
        if (result.status === 'conflict') {
            throw createError({
                statusCode: 409,
                statusMessage: '長期記憶が他の操作で更新されているため上書きしませんでした。',
                data: { conflict: true, prompts: result.prompts, configured: result.configured }
            });
        }
        return { success: true, memory: result.memory, prompts: result.prompts, configured: result.configured };
    }

    // 編集画面からの全項目保存経路
    const rawPrompts = body?.prompts;
    if (!rawPrompts || typeof rawPrompts !== 'object' || Array.isArray(rawPrompts)) {
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

    let saved;
    try {
        saved = writeUserMascotPrompts(userId, mascotId, prompts, {
            expectedRevision: typeof body.expectedRevision === 'string' ? body.expectedRevision : undefined,
            allowLegacyLocalFallback: isAuthBypassAllowed() && userId === LOCAL_DEV_BYPASS_USER_ID
        });
    } catch (error) {
        if (error instanceof MascotPromptConflict) throw createError({ statusCode: 409 });
        throw error;
    }
    if (!saved) throw createError({ statusCode: 404 });

    return { success: true, prompts: saved, configured: true };
});
