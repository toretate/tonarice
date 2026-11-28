import { expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageModel } from 'ai';
import { createMemoryIdentity, createMemoryStore } from '../memory-store';
import { appendMemoryTurn, deleteMemoryMessage, memoryMessageId } from '../memory-history';
import { getChatDatabasePath, readChatSequence, saveChatSummary } from '../chat-sequence';
import { prepareThreadContext } from '../thread-summary';

test('prepareThreadContext_保存順と増分要約を保持し削除後の旧世代の確定を拒否する', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tonarice-summary-'));
    let store = createMemoryStore(directory);
    const scope = { userId: 'owner', mascotId: 'mascot', sessionId: 'session', isSecret: false };
    const { thread: threadId } = createMemoryIdentity('owner', 'mascot', 'session', false);
    try {
        const turns = [
            { userId: 300, assistantId: 301, message: '条件は青色です。', reply: '了解' },
            { userId: 100, assistantId: 101, message: '訂正して緑色にします。', reply: '了解' }
        ];
        for (const turn of turns) await appendMemoryTurn(store.memory, scope, turn);
        const filename = (await getChatDatabasePath(store.memory))!;
        const sequence = readChatSequence(filename, threadId);
        expect(sequence.sequence.map(message => message.id)).toEqual(
            [300, 301, 100, 101].map(id => memoryMessageId(scope, id))
        );
        const summarize = vi.fn(async (_previous, _span, _signal) => '現在の条件は緑色です。[TIMER:30,確認][happy]');
        const result = await prepareThreadContext({
            filename, threadId, state: sequence.state,
            messages: sequence.sequence.map((row, index) => ({
                ...row, sender: index % 2 ? 'mascot' : 'user',
                text: index < 3 ? (index === 0 ? turns[0]!.message : turns[1]!.message) : '詳細。'.repeat(180)
            })),
            engine: 'lmstudio', model: {} as LanguageModel, message: '現在の条件は？', systemPrompt: '',
            maxOutputTokens: 4350, signal: new AbortController().signal, summarize
        });
        expect(summarize.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([expect.objectContaining({ text: turns[1]!.message })]));
        expect(result.summary).toBe('現在の条件は緑色です。');
        await store.storage.close();
        store = createMemoryStore(directory);
        await getChatDatabasePath(store.memory);
        const prior = readChatSequence(filename, threadId).state;
        expect(prior.summary).toBe(result.summary);
        await deleteMemoryMessage(store.memory, scope, memoryMessageId(scope, 100));
        expect(readChatSequence(filename, threadId).state.summary).toBe('');
        expect(saveChatSummary(filename, threadId, prior, prior.coveredSeq + 1, '消えた情報')).toBe(false);
    } finally {
        await store.storage.close();
        try { rmSync(directory, { recursive: true, force: true }); } catch { /* OS の一時領域に残す。 */ }
    }
});

test('prepareThreadContext_圧縮が失敗しても直近の原文を予算内で返し別の要約処理を呼ばない', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tonarice-summary-failure-'));
    const store = createMemoryStore(directory);
    try {
        const filename = (await getChatDatabasePath(store.memory))!;
        const summarize = vi.fn().mockRejectedValue(new Error('圧縮失敗'));
        const prefix = 'a'.repeat(2927);
        const messages = [
            { id: 'old', seq: 1, sender: 'user', text: prefix + '絵'.repeat(700) },
            { id: 'new', seq: 2, sender: 'user', text: '直近の制約' }
        ];
        const result = await prepareThreadContext({
            filename, threadId: 'mock-thread', state: { generation: 0, coveredSeq: 0, summary: '' }, messages,
            engine: 'lmstudio', model: {} as LanguageModel, message: '確認', systemPrompt: '',
            signal: new AbortController().signal, summarize
        });
        expect(summarize).toHaveBeenCalledOnce();
        // 予算境界が「絵」の UTF-8 バイト列の途中にある。
        expect(summarize.mock.calls[0]?.[1]?.[0]?.text).toBe(prefix);
        expect(result).toEqual({ summary: '', history: [messages[1]] });
    } finally {
        await store.storage.close();
        try { rmSync(directory, { recursive: true, force: true }); } catch { /* OS の一時領域に残す。 */ }
    }
});
