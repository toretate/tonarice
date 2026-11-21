import type { MastraChatHistoryItem } from './chat-input';
import { appendMemoryTurn, listMemoryMessages, lockMemoryThread, memoryMessageId, memoryMessageText } from './memory-history';
import { getMemoryStore } from './memory-store';

interface MemoryTurnInput {
    memorySessionId?: unknown;
    memoryUserMessageId?: unknown;
    memoryAssistantMessageId?: unknown;
    activeMascotId?: unknown;
}

type MemoryTurn = { kind: 'transient' } | { kind: 'rejected'; message: string } | {
    kind: 'persistent';
    history: MastraChatHistoryItem[];
    savedReply: string | undefined;
    save: (message: string, reply: string, attachments: unknown) => Promise<void>;
    release: () => void;
};

function isScopeId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function isDisplayId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 1 && value <= 8640000000000000;
}

function selectAttachments(attachments: unknown) {
    if (!Array.isArray(attachments)) return;
    return attachments.flatMap(item =>
        (item?.type === 'image' || item?.type === 'file') && typeof item.name === 'string'
        && typeof item.url === 'string' && item.url.startsWith('data:')
            ? [{ type: item.type, name: item.name, url: item.url }] : []
    );
}

/** 履歴を使う発話だけ会話をロックし、読み込みから保存まで同じ処理で扱う。 */
export async function openChatMemoryTurn(userId: string, input: MemoryTurnInput): Promise<MemoryTurn> {
    const { memorySessionId, activeMascotId, memoryUserMessageId, memoryAssistantMessageId } = input;
    if (memorySessionId === undefined) return { kind: 'transient' };
    if (userId === 'anonymous' || !isScopeId(memorySessionId) || !isScopeId(activeMascotId)
        || !isDisplayId(memoryUserMessageId) || !isDisplayId(memoryAssistantMessageId)
        || memoryAssistantMessageId <= memoryUserMessageId) {
        return { kind: 'rejected', message: '履歴を保存する会話を特定できません。' };
    }

    const scope = { userId, mascotId: activeMascotId, sessionId: memorySessionId, isSecret: false };
    const release = lockMemoryThread(scope);
    if (!release) return { kind: 'rejected', message: 'この会話は別の処理を実行中です。' };

    try {
        const { memory } = getMemoryStore();
        const stored = await listMemoryMessages(memory, scope);
        const previousReply = stored.find(item => item.role === 'assistant' && item.id === memoryMessageId(scope, memoryAssistantMessageId));
        const currentUserMessageId = memoryMessageId(scope, memoryUserMessageId);
        const history = stored.filter(item => (item.role === 'assistant' || item.role === 'user') && item.id !== currentUserMessageId)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(-10)
            .map(item => ({ sender: item.role === 'user' ? 'user' : 'mascot', text: memoryMessageText(item) }));
        return {
            kind: 'persistent',
            history,
            savedReply: previousReply ? memoryMessageText(previousReply) : undefined,
            save: (message, reply, attachments) => appendMemoryTurn(memory, scope, {
                userId: memoryUserMessageId,
                assistantId: memoryAssistantMessageId,
                message,
                reply,
                attachments: selectAttachments(attachments)
            }),
            release
        };
    } catch (error) {
        release();
        throw error;
    }
}
