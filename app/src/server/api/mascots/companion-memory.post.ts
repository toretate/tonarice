import { createError, defineEventHandler, readBody } from 'h3';
import { editCompanionState, getCompanionState } from '../../mastra/companion-memory';
import { learningStatus, refreshSharedCompanionSources } from '../../mastra/learning-jobs';
import { isOwnedMascot } from '../../utils/mascot-prompts';

export default defineEventHandler(async event => {
    const userId = event.context.user?.id;
    if (typeof userId !== 'string' || !userId) throw createError({ statusCode: 401 });
    const body = await readBody(event);
    const mascotId = body?.mascotId;
    if (typeof mascotId !== 'string' || !isOwnedMascot(userId, mascotId)) throw createError({ statusCode: 404 });
    const action = typeof body.enabled === 'boolean' ? { enabled: body.enabled }
        : typeof body.deleteId === 'string' ? { deleteId: body.deleteId }
        : typeof body.undoId === 'string' ? { undoId: body.undoId } : undefined;
    if (!action) throw createError({ statusCode: 400 });
    const filename = await refreshSharedCompanionSources(userId, mascotId);
    const result = editCompanionState(userId, mascotId, action);
    if (result === 'gone') throw createError({ statusCode: 404 });
    if (result === 'conflict') throw createError({ statusCode: 409 });
    return { ...getCompanionState(userId, mascotId), reasons: filename ? learningStatus(filename, userId, mascotId) : [] };
});
