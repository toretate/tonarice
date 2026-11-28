import { createError, defineEventHandler, getQuery, setHeader } from 'h3';
import { getCompanionState } from '../../mastra/companion-memory';
import { learningStatus, refreshSharedCompanionSources } from '../../mastra/learning-jobs';
import { isOwnedMascot } from '../../utils/mascot-prompts';

export default defineEventHandler(async event => {
    const userId = event.context.user?.id;
    if (typeof userId !== 'string' || !userId) throw createError({ statusCode: 401 });
    const { mascotId } = getQuery(event);
    if (typeof mascotId !== 'string' || !isOwnedMascot(userId, mascotId)) throw createError({ statusCode: 404 });
    const filename = await refreshSharedCompanionSources(userId, mascotId);
    const state = getCompanionState(userId, mascotId);
    if (!state) throw createError({ statusCode: 404 });
    setHeader(event, 'Cache-Control', 'no-store');
    return { ...state, reasons: filename ? learningStatus(filename, userId, mascotId) : [] };
});
