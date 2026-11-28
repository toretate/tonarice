import { expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryIdentity, createMemoryStore } from '../memory-store';
import { appendMemoryTurn, deleteMemoryMessage, memoryMessageId } from '../memory-history';
import { getChatDatabasePath, withChatDatabase } from '../chat-sequence';
import { keywordTerms, searchConversationKeywords, searchSharedKeywords } from '../chat-keyword-search';
import { searchMemosFromDb } from '../../utils/memos-service';
import { searchTasksFromDb } from '../../utils/tasks-service';
import { mastraKeywordSearchTool } from '../chat-keyword-tool';

vi.mock('../../utils/memos-service', () => ({ searchMemosFromDb: vi.fn() }));
vi.mock('../../utils/tasks-service', () => ({ searchTasksFromDb: vi.fn() }));
vi.mock('../../utils/mascot-prompts', () => ({ isOwnedMascot: vi.fn().mockReturnValue(true) }));

test('searchConversationKeywords_日本語の短語と自然文を検索し会話の所属と削除を照合する', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tonarice-keywords-'));
    const store = createMemoryStore(directory);
    const scope = { userId: 'owner', mascotId: 'mascot', sessionId: 'past', isSecret: false };
    const { thread: currentThread } = createMemoryIdentity('owner', 'mascot', 'current', false);
    const turn = { userId: 100, assistantId: 101, message: '睡眠と締切を相談した。定例会議で合意。', reply: '確認した' };
    try {
        for (const target of [
            scope, { ...scope, sessionId: 'current' }, { ...scope, userId: 'other' },
            { ...scope, mascotId: 'other' }, { ...scope, isSecret: true }
        ]) await appendMemoryTurn(store.memory, target, turn);
        const filename = (await getChatDatabasePath(store.memory))!;
        for (const query of ['睡眠', '睡眠 締切', '前回の定例会議について教えて']) {
            const hits = searchConversationKeywords(filename, 'owner', 'mascot', currentThread, keywordTerms(query));
            expect(hits).toEqual([expect.objectContaining({ sessionId: 'past', text: turn.message })]);
        }
        const id = memoryMessageId(scope, 100);
        withChatDatabase(filename, db => db.exec('DROP TRIGGER tonarice_keyword_delete_source'));
        await deleteMemoryMessage(store.memory, scope, id);
        expect(searchConversationKeywords(filename, 'owner', 'mascot', currentThread, keywordTerms('睡眠 締切'))).toEqual([]);
        await appendMemoryTurn(store.memory, scope, { userId: 55, assistantId: 56, message: '定例会議の修正', reply: '確認した' });
        const later = searchConversationKeywords(filename, 'owner', 'mascot', currentThread, keywordTerms('定例会議'));
        expect(later).toEqual([expect.objectContaining({ text: '定例会議の修正' })]);
    } finally {
        await store.storage.close();
        try { rmSync(directory, { recursive: true, force: true }); } catch { /* OS の一時領域に残す。 */ }
    }
});

test('searchSharedKeywords_ユーザー共有のメモとタスクの出典を区別する', () => {
    vi.mocked(searchMemosFromDb).mockReturnValue([{ id: 'memo-1', content: '今週は睡眠を取る' }] as ReturnType<typeof searchMemosFromDb>);
    vi.mocked(searchTasksFromDb).mockReturnValue([{ id: 'task-1', title: '締切を確認する' }]);
    const hits = searchSharedKeywords('owner', keywordTerms('睡眠 締切'));
    expect(hits.map(({ kind, id }) => ({ kind, id }))).toEqual([
        { kind: 'memo', id: 'memo-1' }, { kind: 'task', id: 'task-1' }
    ]);
    expect(searchMemosFromDb).toHaveBeenCalledWith('owner');
    expect(searchTasksFromDb).toHaveBeenCalledWith('owner');
});

test('searchPastRecords_索引に接続できなくてもツール失敗を応答に変換する', async () => {
    const execute = mastraKeywordSearchTool.execute!;
    const options = {
        requestContext: new Map([['keywordSearchScope', {
            filename: join(tmpdir(), 'tonarice-missing-directory', 'memory.db'),
            owner: 'owner', mascot: 'mascot', currentThread: 'current'
        }]])
    } as unknown as Parameters<typeof execute>[1];
    await expect(execute({ query: '睡眠' }, options)).resolves.toMatchObject({ results: [], unavailable: true });
});
