import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChatMemoryTurn } from '../chat-memory-turn';
import { lockMemoryThread } from '../memory-history';
import * as memoryStore from '../memory-store';

const input = {
    activeMascotId: 'test-mascot',
    memorySessionId: 'test-session',
    memoryUserMessageId: 101,
    memoryAssistantMessageId: 102
};
const scope = { userId: 'test-user', mascotId: input.activeMascotId, sessionId: input.memorySessionId, isSecret: false };

describe('チャット履歴の準備', () => {
    afterEach(() => vi.restoreAllMocks());

    it('openChatMemoryTurn_会話IDがない場合と無効な入力ではDBを開かないこと', async () => {
        const store = vi.spyOn(memoryStore, 'getMemoryStore');
        expect(await openChatMemoryTurn(scope.userId, {})).toEqual({ kind: 'transient' });
        expect(await openChatMemoryTurn('anonymous', input)).toMatchObject({ kind: 'rejected' });
        expect(await openChatMemoryTurn(scope.userId, { ...input, memoryAssistantMessageId: 101 })).toMatchObject({ kind: 'rejected' });
        expect(store).not.toHaveBeenCalled();
    });

    it('openChatMemoryTurn_履歴の読み込みに失敗しても会話のロックを解放すること', async () => {
        vi.spyOn(memoryStore, 'getMemoryStore').mockReturnValue({
            memory: { getThreadById: vi.fn().mockRejectedValue(new Error('読み込み失敗')) }
        } as unknown as ReturnType<typeof memoryStore.getMemoryStore>);
        await expect(openChatMemoryTurn(scope.userId, input)).rejects.toThrow('読み込み失敗');
        const release = lockMemoryThread(scope);
        expect(release).toBeDefined();
        release?.();
    });
});
