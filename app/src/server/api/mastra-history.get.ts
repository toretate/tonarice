import { createError, defineEventHandler, getQuery, setHeader } from 'h3';
import { getMemoryStore } from '../mastra/memory-store';
import { listMemorySessions } from '../mastra/memory-history';
import { createHash } from 'node:crypto';

export default defineEventHandler(async event => {
    setHeader(event, 'Cache-Control', 'no-store');
    const userId = event.context.user?.id;
    if (typeof userId !== 'string' || !userId) throw createError({ statusCode: 401 });
    const { mascotId } = getQuery(event);
    if (typeof mascotId !== 'string' || !mascotId || mascotId.length > 200) throw createError({ statusCode: 400 });
    const selectionScope = createHash('sha256').update(JSON.stringify(['history-selection', userId])).digest('hex');
    return { enabled: true, selectionScope, sessions: await listMemorySessions(getMemoryStore().memory, userId, mascotId) };
});
