import { createError, defineEventHandler, readBody } from 'h3';
import { getMemoryStore } from '../mastra/memory-store';
import { deleteMemoryMessage, deleteMemoryThread, lockMemoryThread, memoryMessageId } from '../mastra/memory-history';
import { refreshSharedCompanionSources } from '../mastra/learning-jobs';

export default defineEventHandler(async event => {
    const userId = event.context.user?.id;
    if (typeof userId !== 'string' || !userId) throw createError({ statusCode: 401 });
    const body = await readBody(event);
    if (typeof body?.mascotId !== 'string' || !body.mascotId || body.mascotId.length > 200
        || typeof body.sessionId !== 'string' || !body.sessionId || body.sessionId.length > 200
        || (body.kind !== 'thread' && (body.kind !== 'message' || !Number.isSafeInteger(body.messageId)))) {
        throw createError({ statusCode: 400 });
    }
    const scope = { userId, mascotId: body.mascotId, sessionId: body.sessionId, isSecret: false };
    const release = lockMemoryThread(scope);
    if (!release) throw createError({ statusCode: 409, statusMessage: 'Conversation is busy' });
    try {
        const { memory } = getMemoryStore();
        if (body.kind === 'thread') await deleteMemoryThread(memory, scope);
        else await deleteMemoryMessage(memory, scope, memoryMessageId(scope, body.messageId));
        await refreshSharedCompanionSources(userId, scope.mascotId);
        return { success: true };
    } finally {
        release();
    }
});
