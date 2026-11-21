import { createError, defineEventHandler, getQuery, setHeader } from 'h3';
import { getMemoryStore } from '../mastra/memory-store';
import { listMemorySessions } from '../mastra/memory-history';

export default defineEventHandler(async event => {
    setHeader(event, 'Cache-Control', 'no-store');
    const userId = event.context.user?.id;
    if (typeof userId !== 'string' || !userId) throw createError({ statusCode: 401 });
    const { mascotId } = getQuery(event);
    if (typeof mascotId !== 'string' || !mascotId || mascotId.length > 200) throw createError({ statusCode: 400 });
    return { enabled: true, sessions: await listMemorySessions(getMemoryStore().memory, userId, mascotId) };
});
