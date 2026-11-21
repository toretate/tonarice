import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Agent } from '@mastra/core/agent';
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { createMemoryIdentity } from '../memory-store';
import { appendMemoryTurn, deleteMemoryMessage, deleteMemoryThread, listMemoryMessages, listMemorySessions, lockMemoryThread, memoryMessageId, memoryMessageText } from '../memory-history';

describe('Mastra Memory の永続化検証', () => {
    it('appendMemoryTurn_画面表示とモデル入力が同じ保存内容を参照し削除が両方に反映されること', async () => {
        const storage = new LibSQLStore({ id: 'ui-memory-test', url: ':memory:' });
        const memory = new Memory({ storage });
        const scope = { userId: 'owner', mascotId: 'mascot', sessionId: 'session', isSecret: false };
        try {
            const turn = { userId: 1000, assistantId: 1001, message: '合言葉', reply: '了解', attachments: [{ type: 'file', name: 'sample.txt', url: 'data:text/plain;base64,QQ==' }] };
            await appendMemoryTurn(memory, scope, turn);
            await appendMemoryTurn(memory, scope, turn);
            const sessions = await listMemorySessions(memory, 'owner', 'mascot');
            expect(sessions).toMatchObject([{ id: 'session', messages: [{ id: 1000, sender: 'user', text: '合言葉', attachments: turn.attachments }, { id: 1001, sender: 'mascot', text: '了解' }] }]);
            expect(sessions[0].messages).toHaveLength(2);
            await appendMemoryTurn(memory, { ...scope, sessionId: 'long-title' }, {
                userId: 2000, assistantId: 2001, message: '12345678901234567890', reply: '了解'
            });
            expect((await listMemorySessions(memory, 'owner', 'mascot')).find(item => item.id === 'long-title')?.title).toBe('123456789012345...');
            await deleteMemoryThread(memory, { ...scope, sessionId: 'long-title' });
            expect(await listMemorySessions(memory, 'other-user', 'mascot')).toEqual([]);
            expect(await listMemorySessions(memory, 'owner', 'other-mascot')).toEqual([]);
            expect(await deleteMemoryMessage(memory, scope, memoryMessageId(scope, 1000))).toBe(true);
            expect((await listMemoryMessages(memory, scope)).map(memoryMessageText)).toEqual(['了解']);
            expect((await listMemorySessions(memory, 'owner', 'mascot'))[0].messages).toHaveLength(1);
            expect(await deleteMemoryThread(memory, scope)).toBe(true);
            expect(await listMemorySessions(memory, 'owner', 'mascot')).toEqual([]);
        } finally {
            await storage.close();
        }
    });

    it('lockMemoryThread_同じ会話への同時変更だけを拒否すること', () => {
        const scope = { userId: 'owner', mascotId: 'mascot', sessionId: 'scope-lock', isSecret: false };
        const release = lockMemoryThread(scope);
        const other = lockMemoryThread({ ...scope, sessionId: 'other' });
        expect(lockMemoryThread(scope)).toBeUndefined();
        expect(other).toBeDefined();
        other?.();
        release?.();
        const next = lockMemoryThread(scope);
        expect(next).toBeDefined();
        next?.();
    });
    it('createMemoryIdentity_ユーザーとマスコットとモードと会話を分離すること', () => {
        const initial = createMemoryIdentity('user-a', 'mascot-a', 'session-a', false);
        expect(createMemoryIdentity('user-a', 'mascot-a', 'session-a', false)).toEqual(initial);
        for (const other of [
            createMemoryIdentity('user-b', 'mascot-a', 'session-a', false),
            createMemoryIdentity('user-a', 'mascot-b', 'session-a', false),
            createMemoryIdentity('user-a', 'mascot-a', 'session-a', true),
            createMemoryIdentity('user-a', 'mascot-a', 'session-b', false)
        ]) expect(other.thread).not.toBe(initial.thread);
        expect(() => createMemoryIdentity('', 'mascot-a', 'session-a', false)).toThrow();
    });
    it('deleteMemoryMessage_別ユーザーや別会話は削除できず所有者だけ削除できること', async () => {
        const storage = new LibSQLStore({ id: 'history-test', url: ':memory:' });
        const memory = new Memory({ storage });
        try {
            const scope = { userId: 'user-a', mascotId: 'mascot-a', sessionId: 'session-a', isSecret: false };
            const agent = new Agent({ id: 'history-test-agent', name: 'テスト', instructions: 'テスト', model: createMockModel({ mockText: '返答', version: 'v2' }) as never, memory });
            await agent.generate('削除対象', { memory: createMemoryIdentity(scope.userId, scope.mascotId, scope.sessionId, scope.isSecret) });
            const messages = await listMemoryMessages(memory, scope);
            const target = messages.find(item => JSON.stringify(item.content).includes('削除対象'));
            expect(target).toBeDefined();
            expect(await deleteMemoryMessage(memory, { ...scope, userId: 'user-b' }, target!.id)).toBe(false);
            expect(await deleteMemoryMessage(memory, { ...scope, sessionId: 'other' }, target!.id)).toBe(false);
            expect(await deleteMemoryThread(memory, { ...scope, isSecret: true })).toBe(false);
            expect(await deleteMemoryMessage(memory, scope, target!.id)).toBe(true);
            expect((await listMemoryMessages(memory, scope)).some(item => item.id === target!.id)).toBe(false);
            expect(await deleteMemoryThread(memory, scope)).toBe(true);
            await memory.settled();
        } finally {
            await storage.close();
        }
    });
    it('generate_再接続後に同じ会話だけを参照すること', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'tonarice-memory-test-'));
        const url = pathToFileURL(join(directory, 'memory.db')).href;
        const firstStore = new LibSQLStore({ id: 'test-storage-1', url });
        let secondStore: LibSQLStore | undefined;
        try {
            const firstMemory = new Memory({ storage: firstStore, options: { lastMessages: 10 } });
            const firstAgent = new Agent({ id: 'test-agent-1', name: 'テスト', instructions: 'テスト', model: createMockModel({ mockText: '記憶しました', version: 'v2' }) as never, memory: firstMemory });
            await firstAgent.generate('合言葉は青いリボンです', { memory: { resource: 'user-a', thread: 'thread-a' } });
            await firstMemory.settled();
            await firstStore.close();
            secondStore = new LibSQLStore({ id: 'test-storage-2', url });
            const secondMemory = new Memory({ storage: secondStore, options: { lastMessages: 10 } });
            const spy = vi.fn();
            const secondAgent = new Agent({ id: 'test-agent-2', name: 'テスト', instructions: 'テスト', model: createMockModel({ mockText: 'はい', spyGenerate: spy, version: 'v2' }) as never, memory: secondMemory });
            await secondAgent.generate('合言葉は？', { memory: { resource: 'user-a', thread: 'thread-a' } });
            expect(JSON.stringify(spy.mock.calls[0])).toContain('青いリボン');
            spy.mockClear();
            await secondAgent.generate('こんにちは', { memory: { resource: 'user-b', thread: 'thread-b' } });
            expect(JSON.stringify(spy.mock.calls[0])).not.toContain('青いリボン');
            const stored = await secondMemory.recall({ threadId: 'thread-a', resourceId: 'user-a' });
            const target = stored.messages.find(item => JSON.stringify(item.content).includes('青いリボン'));
            expect(target).toBeDefined();
            await secondMemory.deleteMessages([target!.id]);
            spy.mockClear();
            await secondAgent.generate('合言葉は？', { memory: { resource: 'user-a', thread: 'thread-a' } });
            expect(JSON.stringify(spy.mock.calls[0])).not.toContain('青いリボン');
            await secondMemory.deleteThread('thread-a');
            spy.mockClear();
            await secondAgent.generate('合言葉は？', { memory: { resource: 'user-a', thread: 'thread-a' } });
            expect(JSON.stringify(spy.mock.calls[0])).not.toContain('青いリボン');
            await secondMemory.settled();
        } finally {
            if (secondStore) await secondStore.close();
            else await firstStore.close();
            // WindowsではネイティブDBのファイル解放が遅れるため、削除失敗時は一時領域へ残す。
            try { rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* OSの一時領域に任せる */ }
        }
    });
});
