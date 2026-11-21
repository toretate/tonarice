import type { Memory } from '@mastra/memory';
import { createMemoryIdentity } from './memory-store';

export interface HistoryScope {
    userId: string;
    mascotId: string;
    sessionId: string;
    isSecret: boolean;
}

/** 認証済み利用者の会話に属するメッセージだけを取得する。 */
export async function listMemoryMessages(memory: Memory, scope: HistoryScope) {
    const { resource, thread } = createMemoryIdentity(scope.userId, scope.mascotId, scope.sessionId, scope.isSecret);
    const owner = await memory.getThreadById({ threadId: thread, resourceId: resource });
    if (!owner || owner.resourceId !== resource) return [];
    const result = await memory.recall({ threadId: thread, resourceId: resource, perPage: false });
    return result.messages;
}

export function memoryMessageId(scope: HistoryScope, id: number): string {
    return `${createMemoryIdentity(scope.userId, scope.mascotId, scope.sessionId, scope.isSecret).thread}:${id}`;
}

export async function appendMemoryTurn(memory: Memory, scope: HistoryScope, turn: {
    userId: number;
    assistantId: number;
    message: string;
    reply: string;
    attachments?: unknown[];
}) {
    const { resource, thread } = createMemoryIdentity(scope.userId, scope.mascotId, scope.sessionId, scope.isSecret);
    const existing = await memory.getThreadById({ threadId: thread, resourceId: resource });
    if (!existing) {
        const now = new Date();
        await memory.saveThread({ thread: {
            id: thread, resourceId: resource, createdAt: now, updatedAt: now,
            title: turn.message.slice(0, 30) || '新しい話題', metadata: { sessionId: scope.sessionId }
        } });
    }
    const makeMessage = (id: number, role: 'user' | 'assistant', value: string) => ({
        id: memoryMessageId(scope, id), role, threadId: thread, resourceId: resource,
        createdAt: new Date(id), content: {
            format: 2 as const, parts: [{ type: 'text' as const, text: value }],
            metadata: { displayId: id, ...(role === 'user' && turn.attachments?.length ? { attachments: turn.attachments } : {}) }
        }
    });
    await memory.saveMessages({ messages: [
        makeMessage(turn.userId, 'user', turn.message), makeMessage(turn.assistantId, 'assistant', turn.reply)
    ] });
}

export async function listMemorySessions(memory: Memory, userId: string, mascotId: string) {
    const { resource } = createMemoryIdentity(userId, mascotId, 'list', false);
    const { threads } = await memory.listThreads({ filter: { resourceId: resource }, perPage: false });
    return (await Promise.all(threads.filter(thread => thread.resourceId === resource).map(async thread => {
        const id = thread.metadata?.sessionId;
        if (typeof id !== 'string' || !id) return null;
        const stored = await listMemoryMessages(memory, { userId, mascotId, sessionId: id, isSecret: false });
        const messages = stored.flatMap(message => {
            const { displayId, attachments } = message.content.metadata ?? {};
            if (typeof displayId !== 'number' || (message.role !== 'user' && message.role !== 'assistant')) return [];
            return [{
                id: displayId, sender: message.role === 'user' ? 'user' : 'mascot',
                text: memoryMessageText(message), timestamp: message.createdAt.getTime(),
                ...(Array.isArray(attachments) ? { attachments } : {})
            }];
        }).sort((a, b) => a.id - b.id);
        return { id, title: thread.title || '新しい話題', timestamp: messages.at(-1)?.timestamp ?? thread.updatedAt.getTime(), messages };
    }))).filter(session => session !== null).sort((a, b) => b.timestamp - a.timestamp);
}

export function memoryMessageText(message: Awaited<ReturnType<typeof listMemoryMessages>>[number]): string {
    return message.content.parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('');
}

const busyThreads = new Set<string>();

/** 実行中の会話を削除で復活させないよう、生成・保存と削除を排他にする。 */
export function lockMemoryThread(scope: HistoryScope): (() => void) | undefined {
    const { thread } = createMemoryIdentity(scope.userId, scope.mascotId, scope.sessionId, scope.isSecret);
    if (busyThreads.has(thread)) return;
    busyThreads.add(thread);
    return () => { busyThreads.delete(thread); };
}

/** 会話の所有者とメッセージの所属を検証し、異なる会話のデータを削除しない。 */
export async function deleteMemoryMessage(memory: Memory, scope: HistoryScope, messageId: string): Promise<boolean> {
    if (!messageId) return false;
    const messages = await listMemoryMessages(memory, scope);
    if (!messages.some(message => message.id === messageId)) return false;
    await memory.deleteMessages([messageId]);
    return true;
}

/** 同じ利用者・マスコット・モードに属する会話だけを削除する。 */
export async function deleteMemoryThread(memory: Memory, scope: HistoryScope): Promise<boolean> {
    const { resource, thread } = createMemoryIdentity(scope.userId, scope.mascotId, scope.sessionId, scope.isSecret);
    const owner = await memory.getThreadById({ threadId: thread, resourceId: resource });
    if (!owner || owner.resourceId !== resource) return false;
    await memory.deleteThread(thread);
    return true;
}
